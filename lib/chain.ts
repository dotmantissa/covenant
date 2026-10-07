/**
 * Transport layer for talking to the three contracts.
 *
 * Everything here runs on the server. The browser never holds a key and never
 * speaks to the chain, so there is no client-side counterpart to this file.
 *
 * Two hard-won rules are encoded here, and both are easy to get wrong:
 *
 *  - A settled transaction is not a successful one. Studionet leaves
 *    tx_execution_result unset and reports the outcome only on the leader
 *    receipt, so that is the field `assertExecuted` reads. Treating a FINALIZED
 *    status as success silently passes reverted writes.
 *  - A failed poll is not a failed write. Studionet drops connections under its
 *    rate limit, so `withRetry` retries transient transport errors and rethrows
 *    anything that names a real on-chain outcome.
 */
import "@/lib/net";
import { createAccount, createClient } from "genlayer-js";
import * as chains from "genlayer-js/chains";
import {
  executionResultNumberToName,
  transactionsStatusNumberToName,
} from "genlayer-js/types";
import type {
  GenLayerChain,
  GenLayerClient,
  GenLayerTransaction,
  TransactionHash,
} from "genlayer-js/types";
import { contractAddresses, genlayerNetwork } from "@/lib/env";
import { deriveAccount } from "@/lib/signer";

export type Client = GenLayerClient<GenLayerChain>;

export const addresses = contractAddresses;

function chain(): GenLayerChain {
  const alias = genlayerNetwork();
  const found = (chains as Record<string, unknown>)[alias];
  if (!found) {
    throw new Error(
      `unknown GENLAYER_NETWORK ${alias}, expected one of ${Object.keys(chains).join(", ")}`,
    );
  }
  return found as GenLayerChain;
}

let readOnly: Client | undefined;

/** Client for view calls. Holds no key, so it can be shared. */
export function readClient(): Client {
  if (!readOnly) readOnly = createClient({ chain: chain() });
  return readOnly;
}

/**
 * Client that signs as the given Privy user.
 *
 * The key is derived on the way in and lives only as long as the client, which
 * lives only as long as the request. Nothing is cached, because caching a
 * client would mean caching a key.
 */
export function clientFor(privyDid: string): Client {
  const { privateKey } = deriveAccount(privyDid);
  return createClient({ chain: chain(), account: createAccount(privateKey) });
}

// ------------------------------------------------------------------ retries

const TRANSIENT =
  /fetch failed|socket|ECONN|ETIMEDOUT|EAI_AGAIN|network|timeout|429|-32429|-32028|502|503|504/i;

/**
 * Retries a transient transport failure with linear backoff.
 *
 * Studionet is rate limited to 60 requests a minute and 32 in flight
 * transactions per sender, and it also drops connections outright. None of that
 * means a transaction was lost, so a failed poll must never be reported as a
 * failed write. Errors that name a real on-chain outcome are rethrown at once.
 */
export async function withRetry<T>(
  label: string,
  attempt: () => Promise<T>,
  tries = 6,
): Promise<T> {
  let last: unknown;
  for (let i = 1; i <= tries; i += 1) {
    try {
      return await attempt();
    } catch (error) {
      last = error;
      const message = error instanceof Error ? error.message : String(error);
      if (!TRANSIENT.test(message)) throw error;
      if (i === tries) break;
      await new Promise((resolve) => setTimeout(resolve, i * 2500));
    }
  }
  throw new Error(
    `${label} failed after ${tries} attempts: ` +
      (last instanceof Error ? last.message : String(last)),
  );
}

// ----------------------------------------------------------------- receipts

/** Resolves a receipt field that may arrive as either a name or an index. */
function nameOf(
  name: string | undefined,
  numeric: number | string | undefined,
  table: Record<number, string>,
): string {
  if (name) return name;
  if (numeric === undefined || numeric === null) return "";
  return table[Number(numeric)] ?? String(numeric);
}

export class ContractRevert extends Error {
  constructor(
    message: string,
    readonly label: string,
  ) {
    super(message);
    this.name = "ContractRevert";
  }
}

/**
 * Throws unless the receipt says the contract code ran and succeeded.
 *
 * A lifecycle status of FINALIZED only means consensus settled on an outcome,
 * which includes settling on a revert.
 */
export function assertExecuted(label: string, receipt: GenLayerTransaction): void {
  const status =
    nameOf(receipt.statusName, receipt.status, transactionsStatusNumberToName) ||
    "unknown";

  const leaders = receipt.consensus_data?.leader_receipt ?? [];
  const execution =
    nameOf(
      receipt.txExecutionResultName,
      receipt.txExecutionResult,
      executionResultNumberToName,
    ) ||
    leaders[0]?.execution_result ||
    "";

  const leaderError = leaders.find((leader) => leader?.error)?.error;
  if (/ERROR|FAIL|ROLLBACK|REVERT/i.test(execution) || leaderError) {
    throw new ContractRevert(
      cleanRevert(leaderError) ?? `${label} reverted (${execution || status})`,
      label,
    );
  }
  if (status !== "ACCEPTED" && status !== "FINALIZED") {
    throw new Error(`${label} did not settle, status ${status}`);
  }
  if (!execution) {
    throw new Error(
      `${label} settled as ${status} but reported no execution result, ` +
        "so success cannot be confirmed",
    );
  }
}

/**
 * Pulls the contract's own message out of a Python traceback.
 *
 * The contracts raise `gl.vm.UserError` with a sentence meant for a person, and
 * that sentence is what should reach the UI, not 40 lines of frames.
 */
function cleanRevert(error: string | null | undefined): string | undefined {
  if (!error) return undefined;
  const match = error.match(/UserError:\s*(.+?)\s*$/m) ?? error.match(/Error:\s*(.+?)\s*$/m);
  const message = (match?.[1] ?? error).trim();
  return message.replace(/^expected:\s*/i, "");
}

// -------------------------------------------------------------- read, write

/** Calls a view method. */
export async function readView<T>(
  address: `0x${string}`,
  functionName: string,
  args: unknown[] = [],
): Promise<T> {
  const result = await withRetry(`${functionName} read`, () =>
    readClient().readContract({ address, functionName, args: args as never[] }),
  );
  return result as T;
}

export type WriteResult = {
  hash: TransactionHash;
  receipt: GenLayerTransaction;
  /** Whatever the method returned, when the receipt carried it. */
  returned: unknown;
};

/**
 * Sends a write and waits for it to settle, then proves it actually ran.
 *
 * Waits for FINALIZED rather than ACCEPTED. On studionet a transaction can be
 * accepted and then rotated, and the app should not show a borrower a draw that
 * might still be undone.
 */
export async function sendWrite(
  client: Client,
  label: string,
  address: `0x${string}`,
  functionName: string,
  args: unknown[] = [],
  value = 0n,
): Promise<WriteResult> {
  const hash = await withRetry(label, () =>
    client.writeContract({
      address,
      functionName,
      args: args as never[],
      value,
    }),
  );
  const receipt = await withRetry(`${label} receipt`, () =>
    client.waitForTransactionReceipt({
      hash: hash as TransactionHash,
      status: "FINALIZED" as never,
      interval: 5000,
      retries: 120,
    }),
  );
  assertExecuted(label, receipt);

  const leader = receipt.consensus_data?.leader_receipt?.[0];
  return { hash: hash as TransactionHash, receipt, returned: leader?.result };
}

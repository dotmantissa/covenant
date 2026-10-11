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
 *    rate limit, so `withRetry` retries reads and receipt polls. Writes are
 *    submitted once to avoid re-signing a possibly accepted value transfer.
 */
import "@/lib/net";
import { abi, createAccount, createClient } from "genlayer-js";
import * as chains from "genlayer-js/chains";
import {
  executionResultNumberToName,
  transactionsStatusNumberToName,
  transactionResultNumberToName,
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
export function clientFor(privyDid: string, beforeBroadcast?: (signed: `0x${string}`) => Promise<void>): Client {
  const { privateKey } = deriveAccount(privyDid);
  const account = createAccount(privateKey);
  if (beforeBroadcast) {
    const sign = account.signTransaction;
    account.signTransaction = (async (...args: Parameters<typeof sign>) => {
      const signed = await sign(...args);
      await beforeBroadcast(signed);
      return signed;
    }) as typeof sign;
  }
  return createClient({ chain: chain(), account });
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
  if (execution !== "SUCCESS") {
    throw new Error(`${label} reported an unrecognized execution result: ${execution}`);
  }
  const consensus = nameOf(receipt.resultName, receipt.result, transactionResultNumberToName);
  if (consensus !== "AGREE" && consensus !== "MAJORITY_AGREE") {
    throw new Error(`${label} did not reach agreeing consensus (${consensus || "unknown"})`);
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
  // A lost submission response may already have committed the signed write.
  // Retrying writeContract can assign a new nonce and duplicate a value payment.
  const hash = await client.writeContract({
    address,
    functionName,
    args: args as never[],
    value,
  });
  const receipt = await withRetry(`${label} receipt`, () =>
    client.waitForTransactionReceipt({
      hash: hash as TransactionHash,
      status: "FINALIZED" as never,
      interval: 5000,
      retries: 120,
    }),
  );
  assertExecuted(label, receipt);
  await waitForEmittedTransactions(client, hash as TransactionHash, label);

  const leader = receipt.consensus_data?.leader_receipt?.[0];
  return { hash: hash as TransactionHash, receipt, returned: decodeContractResult(leader?.result) };
}


/** Studio native SENDs have a credited ledger marker instead of VM receipts. */
export function assertSettlementChild(label: string, receipt: GenLayerTransaction, parent: string): void {
  if (receipt.type !== 0) {
    assertExecuted(label, receipt);
    return;
  }
  const native = receipt as GenLayerTransaction & {
    value_credited?: boolean; triggered_by?: string; triggered_on?: string;
  };
  const status = nameOf(receipt.statusName, receipt.status, transactionsStatusNumberToName);
  if (status !== "FINALIZED" || native.value_credited !== true ||
      native.triggered_by !== parent || native.triggered_on !== "finalized" ||
      !receipt.to_address || !receipt.from_address || !(Number(receipt.value) > 0)) {
    throw new Error(`${label} native transfer settlement cannot be confirmed`);
  }
}

/** A finalized parent may have independently failing settlement children. */
export async function waitForEmittedTransactions(
  client: Client, hash: TransactionHash, label: string, seen = new Set<string>(),
): Promise<void> {
  if (seen.has(hash)) return;
  seen.add(hash);
  const children = await withRetry(`${label} emitted messages`, () =>
    client.getTriggeredTransactionIds({ hash }),
  );
  for (const child of children) {
    const receipt = await withRetry(`${label} child receipt`, () =>
      client.waitForTransactionReceipt({ hash: child, status: "FINALIZED" as never,
        interval: 5000, retries: 120 }),
    );
    // Studio’s simplified/viem-formatted native receipts omit type and linkage.
    // Read the raw ledger record when no VM consensus receipt is present.
    const settlement = !receipt.consensus_data
      ? await withRetry(`${label} native ledger`, async () =>
          await client.request({ method: "eth_getTransactionByHash", params: [child] }) as unknown as GenLayerTransaction)
      : receipt;
    assertSettlementChild(`${label} settlement ${child}`, settlement, hash);
    await waitForEmittedTransactions(client, child, label, seen);
  }
}

/** Decode the actual return envelope, including Studio's base64 raw field. */
export function decodeContractResult(value: unknown): unknown {
  if (!value || typeof value !== "object" || !("raw" in value) || typeof value.raw !== "string") return value;
  const encoded = Buffer.from(value.raw, "base64");
  if (encoded[0] !== 0) throw new Error("contract result is not a successful return envelope");
  const decoded = abi.calldata.decode(encoded.subarray(1));
  return JSON.parse(JSON.stringify(decoded, (_key, v) => v instanceof Map ? Object.fromEntries(v) : typeof v === "bigint" ? (v <= BigInt(Number.MAX_SAFE_INTEGER) && v >= BigInt(Number.MIN_SAFE_INTEGER) ? Number(v) : v.toString()) : v));
}

/** Bounded observation; polling is driven by durable intents instead of HTTP sleeps. */
export async function inspectSettlement(client: Client, hash: TransactionHash, label: string): Promise<GenLayerTransaction | null> {
  const root = await client.getTransaction({ hash });
  if (nameOf(root.statusName, root.status, transactionsStatusNumberToName) !== "FINALIZED") return null;
  try { assertExecuted(label, root); }
  catch(error) { throw error instanceof ContractRevert ? error : new ContractRevert(error instanceof Error ? error.message : "Finalized execution failed",label); }
  const queue: { hash: TransactionHash; parent: string }[] = [];
  for (const child of await client.getTriggeredTransactionIds({hash})) queue.push({hash:child,parent:hash});
  const seen = new Set<string>();
  while (queue.length) {
    if (seen.size >= 100) throw new Error("settlement graph exceeds the bounded observer limit");
    const item = queue.shift()!;
    if (seen.has(item.hash)) continue;
    seen.add(item.hash);
    const receipt = await client.getTransaction({ hash:item.hash });
    if (nameOf(receipt.statusName, receipt.status, transactionsStatusNumberToName) !== "FINALIZED") return null;
    const settlement = !receipt.consensus_data
      ? await client.request({method:"eth_getTransactionByHash",params:[item.hash]}) as unknown as GenLayerTransaction
      : receipt;
    try { assertSettlementChild(`${label} settlement ${item.hash}`,settlement,item.parent); }
    catch(error) { throw new SettlementFailure(error instanceof Error?error.message:"Settlement failed"); }
    for (const child of await client.getTriggeredTransactionIds({hash:item.hash})) queue.push({hash:child,parent:item.hash});
  }
  return root;
}

export class SettlementFailure extends Error {}

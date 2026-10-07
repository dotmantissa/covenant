/**
 * Deploys the three Covenant contracts to the configured GenLayer network and
 * wires them to each other.
 *
 * Run with `npm run deploy:contracts`.
 *
 * Why this exists rather than `genlayer deploy`: the CLI coerces any bare
 * 40 hex character `0x...` argument into a calldata address, and all three
 * constructors and setters take the peer address as a `str`. There is no way to
 * spell "string that happens to look like an address" on the CLI, so the
 * monitor and the vault cannot be constructed through it. genlayer-js lets the
 * calldata types be stated exactly, and the backend signing service needs it
 * anyway.
 *
 * The script is safe to re-run. Addresses already recorded in
 * deploy/addresses.json are reused instead of deployed again, and the four
 * wiring setters are idempotent, so a crashed run is resumed by running it
 * again.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Wallet } from "ethers";
import { createClient, createAccount } from "genlayer-js";
import * as chains from "genlayer-js/chains";
import {
  executionResultNumberToName,
  transactionsStatusNumberToName,
} from "genlayer-js/types";
import type { GenLayerTransaction, TransactionHash } from "genlayer-js/types";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ADDRESS_FILE = join(ROOT, "deploy", "addresses.json");
const ENV_FILE = join(ROOT, ".env.local");

type ContractKey = "facilityRegistry" | "covenantMonitor" | "creditVault";

/** Which env var in .env.local holds each address. */
const ENV_KEYS: Record<ContractKey, string> = {
  facilityRegistry: "NEXT_PUBLIC_FACILITY_REGISTRY_ADDRESS",
  covenantMonitor: "NEXT_PUBLIC_COVENANT_MONITOR_ADDRESS",
  creditVault: "NEXT_PUBLIC_CREDIT_VAULT_ADDRESS",
};

const SOURCES: Record<ContractKey, string> = {
  facilityRegistry: "contracts/facility_registry.py",
  covenantMonitor: "contracts/covenant_monitor.py",
  creditVault: "contracts/credit_vault.py",
};

// ------------------------------------------------------------------ env

/** Minimal dotenv reader. Values are never logged. */
function readEnvFile(path: string): Map<string, string> {
  const out = new Map<string, string>();
  if (!existsSync(path)) return out;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    out.set(trimmed.slice(0, eq), trimmed.slice(eq + 1));
  }
  return out;
}

function required(env: Map<string, string>, key: string): string {
  const value = process.env[key] ?? env.get(key) ?? "";
  if (!value) throw new Error(`${key} is not set in .env.local`);
  return value;
}

/**
 * Rewrites the given keys in .env.local in place, preserving comments, order
 * and every other line. Appends a key that is not already present.
 */
function patchEnvFile(path: string, updates: Record<string, string>): void {
  const lines = existsSync(path) ? readFileSync(path, "utf8").split("\n") : [];
  const pending = new Set(Object.keys(updates));

  const patched = lines.map((line) => {
    const eq = line.indexOf("=");
    if (eq < 1 || line.trimStart().startsWith("#")) return line;
    const key = line.slice(0, eq);
    if (!pending.has(key)) return line;
    pending.delete(key);
    return `${key}=${updates[key]}`;
  });

  for (const key of pending) patched.push(`${key}=${updates[key]}`);
  writeFileSync(path, patched.join("\n"));
}

// --------------------------------------------------------------- receipts

/**
 * Retries a transient RPC failure with linear backoff.
 *
 * Studionet drops connections under its rate limit (60 requests a minute) and
 * occasionally fails a poll outright with `fetch failed`. Neither means the
 * transaction is lost, so a failed poll must not be read as a failed write.
 * Errors that name a real on-chain outcome are rethrown immediately.
 */
async function withRetry<T>(
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
      if (!/fetch failed|socket|ECONN|ETIMEDOUT|EAI_AGAIN|network|timeout|429|-32429/i.test(message)) {
        throw error;
      }
      const waitMs = i * 5000;
      console.log(`    ${label}: transient RPC failure, retry ${i}/${tries} in ${waitMs / 1000}s`);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
  throw last;
}

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

/**
 * A FINALIZED lifecycle status does not mean the code ran. Studionet leaves
 * txExecutionResult unset and reports the outcome only on the leader receipt,
 * as `execution_result: "SUCCESS"`, so that is the field to trust. Treating a
 * FINALIZED status as success on its own silently passes reverted writes.
 */
function assertExecuted(label: string, receipt: GenLayerTransaction): void {
  const status = nameOf(
    receipt.statusName,
    receipt.status,
    transactionsStatusNumberToName,
  ) || "unknown";

  const leaders = receipt.consensus_data?.leader_receipt ?? [];
  const execution =
    nameOf(
      receipt.txExecutionResultName,
      receipt.txExecutionResult,
      executionResultNumberToName,
    ) || leaders[0]?.execution_result || "";

  const failed = /ERROR|FAIL|ROLLBACK|REVERT/i.test(execution);
  const leaderError = leaders.find((leader) => leader?.error)?.error;

  if (failed || leaderError) {
    throw new Error(
      `${label} reverted. status=${status} execution=${execution || "unset"}\n` +
        `${leaderError ?? "no error detail on the leader receipt"}`,
    );
  }
  if (status !== "ACCEPTED" && status !== "FINALIZED") {
    throw new Error(`${label} did not settle. status=${status}`);
  }
  if (!execution) {
    // Never pass this off as verified. Nothing on the receipt said the code ran.
    throw new Error(
      `${label} settled as ${status} but no execution result was reported, ` +
        `so success cannot be confirmed. Inspect the transaction before continuing.`,
    );
  }
  console.log(`    ${label}: ${status}, ${execution}`);
}

// ------------------------------------------------------------------- main

async function main(): Promise<void> {
  const env = readEnvFile(ENV_FILE);
  const networkAlias = required(env, "GENLAYER_NETWORK");
  const accountName = required(env, "GENLAYER_DEPLOYER_ACCOUNT");
  const password = required(env, "COVENANT_KEYSTORE_PASSWORD");

  const chain = (chains as Record<string, unknown>)[networkAlias];
  if (!chain) {
    throw new Error(
      `unknown network ${networkAlias}, expected one of ${Object.keys(chains).join(", ")}`,
    );
  }

  // The CLI keystore is a standard web3 encrypted JSON, so ethers can open it.
  // This machine has no OS keychain, so `genlayer account unlock` is not an
  // option and the key is decrypted here instead, in memory only.
  const keystorePath = join(
    process.env.HOME ?? "",
    ".genlayer",
    "keystores",
    `${accountName}.json`,
  );
  if (!existsSync(keystorePath)) {
    throw new Error(`no keystore for account ${accountName} at ${keystorePath}`);
  }
  const wallet = await Wallet.fromEncryptedJson(
    readFileSync(keystorePath, "utf8"),
    password,
  );
  const account = createAccount(wallet.privateKey as `0x${string}`);

  const client = createClient({ chain: chain as never, account });
  console.log(`network  ${networkAlias}`);
  console.log(`deployer ${account.address}\n`);

  const addresses: Partial<Record<ContractKey, string>> = existsSync(ADDRESS_FILE)
    ? JSON.parse(readFileSync(ADDRESS_FILE, "utf8")).contracts ?? {}
    : {};

  /** Persists after every deploy so a crash never loses a deployed address. */
  function persist(): void {
    mkdirSync(dirname(ADDRESS_FILE), { recursive: true });
    writeFileSync(
      ADDRESS_FILE,
      `${JSON.stringify(
        {
          network: networkAlias,
          chainId: (chain as { id: number }).id,
          deployer: account.address,
          deployedAt: new Date().toISOString(),
          contracts: addresses,
        },
        null,
        2,
      )}\n`,
    );
  }

  async function deploy(key: ContractKey, args: unknown[]): Promise<string> {
    const existing = addresses[key];
    if (existing) {
      console.log(`${key}: already at ${existing}, skipping deploy`);
      return existing;
    }
    console.log(`${key}: deploying`);
    const code = readFileSync(join(ROOT, SOURCES[key]), "utf8");
    const hash = await withRetry(`${key} deploy`, () =>
      client.deployContract({ code, args: args as never[] }),
    );
    console.log(`    tx ${hash}`);
    const receipt = await withRetry(`${key} deploy receipt`, () =>
      client.waitForTransactionReceipt({
        hash: hash as TransactionHash,
        status: "FINALIZED" as never,
        interval: 5000,
        retries: 120,
      }),
    );
    assertExecuted(`${key} deploy`, receipt);

    const address = (receipt.data as { contract_address?: string })?.contract_address
      ?? (receipt.to_address as string | undefined)
      ?? (receipt.recipient as string | undefined);
    if (!address) {
      throw new Error(`${key}: no contract address on receipt ${hash}`);
    }
    addresses[key] = address;
    persist();
    console.log(`    ${key} -> ${address}\n`);
    return address;
  }

  async function write(
    label: string,
    address: string,
    functionName: string,
    args: unknown[],
  ): Promise<void> {
    console.log(`wiring ${label}`);
    const hash = await withRetry(label, () =>
      client.writeContract({
        address: address as `0x${string}`,
        functionName,
        args: args as never[],
        value: 0n,
      }),
    );
    console.log(`    tx ${hash}`);
    const receipt = await withRetry(`${label} receipt`, () =>
      client.waitForTransactionReceipt({
        hash: hash as TransactionHash,
        status: "FINALIZED" as never,
        interval: 5000,
        retries: 120,
      }),
    );
    assertExecuted(label, receipt);
  }

  // studionet is rate limited to 60 requests a minute and rejects more than 32
  // in flight transactions from one sender, so everything below is serial.
  const registry = await deploy("facilityRegistry", []);
  const monitor = await deploy("covenantMonitor", [registry]);
  const vault = await deploy("creditVault", [registry]);

  await write("registry.set_monitor", registry, "set_monitor", [monitor]);
  await write("registry.set_vault", registry, "set_vault", [vault]);
  await write("monitor.set_vault", monitor, "set_vault", [vault]);
  await write("vault.set_monitor", vault, "set_monitor", [monitor]);

  console.log("\nverifying wiring from chain state");

  /** Reads a contract's get_wiring and returns it as a flat lookup. */
  async function wiringOf(address: string): Promise<Record<string, unknown>> {
    const result = await withRetry(`get_wiring ${address}`, () =>
      client.readContract({
        address: address as `0x${string}`,
        functionName: "get_wiring",
        args: [],
      }),
    );
    return (result ?? {}) as Record<string, unknown>;
  }

  const seen = {
    registry: await wiringOf(registry),
    monitor: await wiringOf(monitor),
    vault: await wiringOf(vault),
  };
  console.log(JSON.stringify(seen, null, 2));

  // Reading the pointers back is the real proof the four wiring writes ran.
  const expected: Array<[string, unknown, string]> = [
    ["registry.monitor", seen.registry.monitor, monitor],
    ["registry.vault", seen.registry.vault, vault],
    ["monitor.registry", seen.monitor.registry, registry],
    ["monitor.vault", seen.monitor.vault, vault],
    ["vault.registry", seen.vault.registry, registry],
    ["vault.monitor", seen.vault.monitor, monitor],
  ];
  const problems = expected
    .filter(([, actual, want]) => String(actual).toLowerCase() !== want.toLowerCase())
    .map(([name, actual, want]) => `${name}: got ${String(actual)}, want ${want}`);
  if (problems.length) {
    throw new Error(`wiring read back wrong:\n  ${problems.join("\n  ")}`);
  }

  patchEnvFile(ENV_FILE, {
    [ENV_KEYS.facilityRegistry]: registry,
    [ENV_KEYS.covenantMonitor]: monitor,
    [ENV_KEYS.creditVault]: vault,
  });

  console.log(`\nall ${expected.length} wiring pointers verified`);
  console.log(`addresses written to deploy/addresses.json and .env.local`);
}

main().catch((error) => {
  console.error(`\ndeploy failed: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});

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
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Wallet, Interface, type InterfaceAbi } from "ethers";
import { assertExecuted } from "../lib/chain";
import { createClient, createAccount } from "genlayer-js";
import * as chains from "genlayer-js/chains";
import { TransactionHashVariant, type TransactionHash } from "genlayer-js/types";

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
// ------------------------------------------------------------------- main

async function main(): Promise<void> {
  const env = readEnvFile(ENV_FILE);
  const networkAlias = required(env, "GENLAYER_NETWORK");
  const suppliedKey = process.env.GENLAYER_DEPLOYER_PRIVATE_KEY ?? env.get("GENLAYER_DEPLOYER_PRIVATE_KEY");

  const chain = (chains as Record<string, unknown>)[networkAlias];
  if (!chain) {
    throw new Error(
      `unknown network ${networkAlias}, expected one of ${Object.keys(chains).join(", ")}`,
    );
  }

  let privateKey = suppliedKey;
  if (!privateKey) {
    const accountName = required(env, "GENLAYER_DEPLOYER_ACCOUNT");
    const password = required(env, "COVENANT_KEYSTORE_PASSWORD");
    const keystorePath = join(process.env.HOME ?? "", ".genlayer", "keystores", `${accountName}.json`);
    if (!existsSync(keystorePath)) throw new Error(`no keystore for account ${accountName}`);
    privateKey = (await Wallet.fromEncryptedJson(readFileSync(keystorePath, "utf8"), password)).privateKey;
  }
  const account = createAccount(privateKey as `0x${string}`);

  const client = createClient({ chain: chain as never, account });
  const journalFile=join(ROOT,".deploy-journal.json");
  type Operation={signed?:`0x${string}`;hash?:TransactionHash};
  const saved=existsSync(journalFile)?JSON.parse(readFileSync(journalFile,"utf8")):{};
  const journal:{network:string;deployer:string;done:boolean;steps:Record<string,Operation>}=process.argv.includes("--fresh")&&saved.done
    ?{network:networkAlias,deployer:account.address,done:false,steps:{}}
    :saved.network?saved:{network:networkAlias,deployer:account.address,done:false,steps:{}};
  if(journal.network!==networkAlias||journal.deployer.toLowerCase()!==account.address.toLowerCase())throw new Error("Deployment journal belongs to another signer/network");
  function saveJournal(){writeFileSync(journalFile+".tmp",JSON.stringify(journal),{mode:0o600});renameSync(journalFile+".tmp",journalFile);}
  let activeLabel="";
  const sign=account.signTransaction;
  account.signTransaction=(async(...args:Parameters<typeof sign>)=>{
    const raw=await sign(...args),operation=journal.steps[activeLabel]??{};
    if(!activeLabel||operation.signed&&operation.signed!==raw)throw new Error("Refusing to replace a signed operation");
    journal.steps[activeLabel]={...operation,signed:raw};saveJournal();return raw;
  }) as typeof sign;
  async function once(label:string,submit:()=>Promise<`0x${string}`>):Promise<TransactionHash>{
    const operation=journal.steps[label]??{};if(operation.hash)return operation.hash;
    activeLabel=label;
    try {
      let hash:TransactionHash;
      if(operation.signed){
        const broadcast=await withRetry(label,()=>client.sendRawTransaction({serializedTransaction:operation.signed!}));
        if(client.chain.isStudio)hash=broadcast as TransactionHash;
        else {
          const receipt=await client.request({method:"eth_getTransactionReceipt",params:[broadcast]}) as unknown as {status:string;logs:{topics:string[];data:string}[]}|null;
          if(!receipt)throw new Error("Signed operation remains pending; rerun to recover the same envelope");
          if(receipt.status==='0x0')throw new Error("Signed operation reverted before consensus");
          const decoder=new Interface(client.chain.consensusMainContract!.abi as unknown as InterfaceAbi);
          const event=receipt.logs.map(log=>{try{return decoder.parseLog(log);}catch{return null;}}).find(e=>e&&["NewTransaction","CreatedTransaction"].includes(e.name));
          if(!event)throw new Error("Signed operation has not indexed its consensus transaction id");
          hash=String(event.args.txId) as TransactionHash;
        }
      }else hash=await submit() as TransactionHash;
      journal.steps[label]={...journal.steps[label],hash};saveJournal();return hash;
    }finally{activeLabel="";}
  }
  console.log(`network  ${networkAlias}`);
  console.log(`deployer ${account.address}\n`);

  const previous = existsSync(ADDRESS_FILE) && !process.argv.includes("--fresh")
    ? JSON.parse(readFileSync(ADDRESS_FILE, "utf8")) : {};
  const addresses: Partial<Record<ContractKey, string>> = previous.contracts ?? {};
  const sourceHashes: Partial<Record<ContractKey, string>> = previous.sourceHashes ?? {};

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
          sourceHashes,
        },
        null,
        2,
      )}\n`,
    );
  }

  async function deploy(key: ContractKey, args: unknown[]): Promise<string> {
    const code = readFileSync(join(ROOT, SOURCES[key]), "utf8");
    const digest = createHash("sha256").update(code).digest("hex");
    const existing = addresses[key];
    if (existing) {
      if (sourceHashes[key] !== digest) {
        throw new Error(`${key}: stored deployment differs from current source. Run npm run deploy:contracts -- --fresh to deploy the complete new stack.`);
      }
      const deployed=await withRetry(`${key} source`,()=>client.request({method:"gen_getContractCode",params:[existing as `0x${string}`]}));
      if(createHash("sha256").update(Buffer.from(deployed as string,"base64")).digest("hex")!==digest)throw new Error("Recorded address has different on-chain source");
      console.log(`${key}: verified source at ${existing}, skipping deploy`);
      return existing;
    }
    console.log(`${key}: deploying`);
    const hash = await once(`deploy:${key}:${digest}`, () =>
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
    sourceHashes[key] = digest;
    persist();
    const deployed=await withRetry(`${key} source`,()=>client.request({method:"gen_getContractCode",params:[address as `0x${string}`]}));
    if(createHash("sha256").update(Buffer.from(deployed as string,"base64")).digest("hex")!==digest)throw new Error("New deployment source mismatch");
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
    const hash = await once(`${label}:${address}:${JSON.stringify(args)}`, () =>
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

  for(const address of [registry,monitor,vault])await write(`seal:${address}`,address,"seal_wiring",[]);
  console.log("\nverifying wiring from chain state");

  /** Reads a contract's get_wiring and returns it as a flat lookup. */
  async function wiringOf(address: string): Promise<Record<string, unknown>> {
    const result = await withRetry(`get_wiring ${address}`, () =>
      client.readContract({
        address: address as `0x${string}`,
        functionName: "get_wiring",
        args: [], transactionHashVariant:TransactionHashVariant.LATEST_FINAL,
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

  if(!seen.registry.wiring_sealed||!seen.monitor.wiring_sealed||!seen.vault.wiring_sealed)throw new Error("Wiring was not sealed");
  journal.done=true;saveJournal();
  console.log(`\nall ${expected.length} wiring pointers verified`);
  console.log(`addresses written to deploy/addresses.json and .env.local`);
}

main().catch((error) => {
  console.error(`\ndeploy failed: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});

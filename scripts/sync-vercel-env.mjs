import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";

if (!existsSync(".env.local")) {
  console.error("Missing .env.local");
  process.exit(1);
}

const envLines = readFileSync(".env.local", "utf8").split("\n");
const envVars = new Map();

for (const line of envLines) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eq = trimmed.indexOf("=");
  if (eq < 1) continue;
  const key = trimmed.slice(0, eq).trim();
  const val = trimmed.slice(eq + 1).trim();
  envVars.set(key, val);
}

const KEYS_TO_SYNC = [
  "DATABASE_URL",
  "NEXT_PUBLIC_PRIVY_APP_ID",
  "PRIVY_APP_SECRET",
  "SIGNER_MASTER_SECRET",
  "NEXT_PUBLIC_FACILITY_REGISTRY_ADDRESS",
  "NEXT_PUBLIC_COVENANT_MONITOR_ADDRESS",
  "NEXT_PUBLIC_CREDIT_VAULT_ADDRESS",
  "GENLAYER_RPC_URL",
];

for (const key of KEYS_TO_SYNC) {
  const val = envVars.get(key);
  if (!val) {
    console.warn(`Skipping ${key}: not set in .env.local`);
    continue;
  }

  console.log(`Adding ${key} to Vercel...`);
  const proc = spawnSync("vercel", ["env", "add", key, "production,preview"], {
    input: val,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });

  if (proc.status !== 0) {
    // If it already exists, update it
    if ((proc.stderr || "").includes("already exists") || (proc.stdout || "").includes("already exists")) {
      console.log(`  ${key} already exists on Vercel`);
    } else {
      console.error(`  Failed to add ${key}`);
    }
  } else {
    console.log(`  Successfully added ${key}`);
  }
}

console.log("Vercel environment sync complete.");

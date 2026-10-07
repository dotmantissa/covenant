/**
 * Fails if any genuine secret from .env.local appears in a tracked file.
 *
 * Run with `npm run check:secrets`. Intended for the pre-push sweep and for CI.
 *
 * A key counts as secret when its name looks like a credential and it is not
 * NEXT_PUBLIC_. That deliberately excludes the public configuration that also
 * lives in .env.local, such as GENLAYER_NETWORK and GENLAYER_RPC_URL, which are
 * not secrets and do appear in committed code.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, statSync } from "node:fs";

const ENV_FILE = ".env.local";
const SECRET_NAME = /(SECRET|PASSWORD|TOKEN|PRIVATE_KEY|DATABASE_URL|_KEY)$/;

if (!existsSync(ENV_FILE)) {
  console.log(`${ENV_FILE} not present, nothing to check`);
  process.exit(0);
}

const secrets = [];
for (const line of readFileSync(ENV_FILE, "utf8").split("\n")) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eq = trimmed.indexOf("=");
  if (eq < 1) continue;
  const name = trimmed.slice(0, eq);
  const value = trimmed.slice(eq + 1);
  if (name.startsWith("NEXT_PUBLIC_")) continue;
  if (!SECRET_NAME.test(name)) continue;
  // Very short values would match everywhere and mean nothing.
  if (value.length < 8) continue;
  secrets.push({ name, value });
}

if (secrets.length === 0) {
  console.log("no secret values set in .env.local, nothing to check");
  process.exit(0);
}

const tracked = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter(Boolean);

const findings = [];
for (const file of tracked) {
  if (!existsSync(file) || statSync(file).size > 8 * 1024 * 1024) continue;
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  for (const { name, value } of secrets) {
    if (text.includes(value)) findings.push({ file, name });
  }
}

console.log(`checked ${tracked.length} tracked files against ${secrets.length} secrets`);
for (const { name, value } of secrets) {
  console.log(`  ${name} (${value.length} chars)`);
}

if (findings.length > 0) {
  console.error("\nsecret values found in tracked files:");
  for (const { file, name } of findings) console.error(`  ${file} contains ${name}`);
  process.exit(1);
}
console.log("clean: no secret value appears in any tracked file");

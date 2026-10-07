import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const env = readFileSync(".env.local", "utf8");
let token = "";
for (const line of env.split("\n")) {
  const m = line.match(/^GITHUB_TOKEN=(.*)$/);
  if (m) {
    token = m[1].trim();
    break;
  }
}

if (!token) {
  console.error("GITHUB_TOKEN not found in .env.local");
  process.exit(1);
}

const helper = `!f() { echo username=dotmantissa; echo "password=${token}"; }; f`;
try {
  const result = execFileSync(
    "git",
    ["-c", `credential.helper=${helper}`, "push", "-u", "origin", "main"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
  );
  console.log("Push successful:", result || "branch main up to date");
} catch (err) {
  const cleanStderr = (err.stderr || "").replace(new RegExp(token, "g"), "[REDACTED]");
  console.error("Push failed:", cleanStderr || err.message);
  process.exit(1);
}

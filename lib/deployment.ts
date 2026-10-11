import { createHash } from "node:crypto";

/** Physical Postgres isolation for each network and immutable contract stack. */
export function deploymentId(env: Record<string, string | undefined> = process.env): string {
  const identity = [env.GENLAYER_NETWORK ?? "studionet", env.NEXT_PUBLIC_FACILITY_REGISTRY_ADDRESS,
    env.NEXT_PUBLIC_COVENANT_MONITOR_ADDRESS, env.NEXT_PUBLIC_CREDIT_VAULT_ADDRESS]
    .map((value) => (value ?? "unconfigured").toLowerCase()).join(":");
  return createHash("sha256").update(identity).digest("hex");
}

export function deploymentSchema(): string { return `covenant_${deploymentId().slice(0, 24)}`; }

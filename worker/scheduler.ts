/**
 * Standalone scheduler worker for Covenant.
 *
 * Runs periodic covenant tests by querying due covenants from the registry
 * contract and submitting test transactions through GenLayer.
 *
 * Usage:
 *   npm run sweep          # Run a single sweep pass
 *   npm run sweep -- --watch  # Run continuously every interval
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import "@/lib/net";
import { runSweep } from "@/lib/sweep";

const isWatchMode = process.argv.includes("--watch");
const INTERVAL_SECONDS = 60;

async function executePass(): Promise<void> {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] Starting covenant sweep pass...`);

  try {
    const result = await runSweep({ trigger: "cron" });
    console.log(
      `[${timestamp}] Sweep complete (ID #${result.sweepId}): ` +
        `${result.dueCount} due, ${result.testedCount} tested, ${result.failedCount} failed`,
    );

    for (const d of result.details) {
      console.log(
        `  -> Facility ${d.facilityId} Cov #${d.covenantIndex}: ${d.outcome} ` +
          `(${d.status ?? d.message ?? "ok"})`,
      );
    }
  } catch (error) {
    console.error(`[${timestamp}] Sweep error:`, error);
  }
}

async function main(): Promise<void> {
  console.log("Covenant Scheduler Worker started");

  if (!isWatchMode) {
    await executePass();
    process.exit(0);
  }

  console.log(`Watch mode active: running sweep every ${INTERVAL_SECONDS} seconds`);
  await executePass();

  setInterval(() => {
    void executePass();
  }, INTERVAL_SECONDS * 1000);
}

void main();

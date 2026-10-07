/**
 * Scheduler sweep core: finds due covenants, runs tests on chain, and preserves evidence.
 *
 * Shared between the background worker (worker/scheduler.ts) and the HTTP sweep endpoint
 * (/api/sweep) for cron triggering.
 */
import { addresses, clientFor, readView, sendWrite } from "@/lib/chain";
import { db, sweeps, type SweepDetail } from "@/lib/db";
import { recordTestEvidence } from "@/lib/sync";
import { eq } from "drizzle-orm";

export type DueCovenant = {
  facility_id: string;
  covenant_index: number;
  kind: string;
  metric: string;
  next_due_at: string;
  status: string;
};

type RawFinding = {
  facility_id: string;
  covenant_index: number;
  sequence: number;
  kind: string;
  tested_at: string;
  breached: boolean;
  status: string;
  observed_bp: number;
  observed_atto: string;
  threshold_bp: number;
  citation: string;
  locator: string;
  as_of: string;
  numerator_milli: string;
  denominator_milli: string;
  narrative: string;
  consequence_applied: string;
};

type RawParams = {
  source_urls: string[];
};

export type SweepResult = {
  sweepId: number;
  trigger: "cron" | "manual";
  dueCount: number;
  testedCount: number;
  failedCount: number;
  details: SweepDetail[];
};

/**
 * Runs a single scheduler sweep across all facilities.
 */
export async function runSweep(
  options: {
    trigger?: "cron" | "manual";
    signerDid?: string;
  } = {},
): Promise<SweepResult> {
  const trigger = options.trigger ?? "cron";
  const signerDid = options.signerDid ?? "did:privy:covenant_scheduler";

  // Create sweep record
  const [sweepRecord] = await db()
    .insert(sweeps)
    .values({
      trigger,
      startedAt: new Date(),
      dueCount: 0,
      testedCount: 0,
      failedCount: 0,
      detail: [],
    })
    .returning();

  const sweepId = sweepRecord?.id ?? 0;
  const addrs = addresses();
  const client = clientFor(signerDid);

  let dueList: DueCovenant[] = [];
  try {
    dueList = await readView<DueCovenant[]>(
      addrs.facilityRegistry,
      "due_covenants",
    );
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    if (sweepId) {
      await db()
        .update(sweeps)
        .set({
          finishedAt: new Date(),
          error: `Failed to query due covenants: ${errorMsg}`,
        })
        .where(eq(sweeps.id, sweepId));
    }
    throw error;
  }

  const details: SweepDetail[] = [];
  let testedCount = 0;
  let failedCount = 0;

  for (const item of dueList) {
    const facilityId = item.facility_id;
    const covenantIndex = item.covenant_index;

    try {
      // Execute test on chain
      const writeResult = await sendWrite(
        client,
        `sweep:test_covenant:${facilityId}:${covenantIndex}`,
        addrs.covenantMonitor,
        "test_covenant",
        [facilityId, covenantIndex],
      );

      // Read finding and params to record evidence
      const finding = await readView<RawFinding>(
        addrs.covenantMonitor,
        "get_finding",
        [facilityId, covenantIndex],
      );

      const testParams = await readView<RawParams>(
        addrs.facilityRegistry,
        "get_test_parameters",
        [facilityId, covenantIndex],
      );

      const leaderReceipt = writeResult.receipt.consensus_data?.leader_receipt?.[0];
      const leaderAddress = leaderReceipt ? (leaderReceipt as { leader?: string }).leader : undefined;

      await recordTestEvidence({
        facilityId,
        covenantIndex,
        sequence: Number(finding.sequence),
        kind: finding.kind,
        testedAt: finding.tested_at,
        breached: Boolean(finding.breached),
        status: finding.status,
        sourceUrls: testParams.source_urls ?? [],
        citation: finding.citation,
        locator: finding.locator,
        asOf: finding.as_of,
        numeratorMilli: finding.numerator_milli,
        denominatorMilli: finding.denominator_milli,
        observedBp: Number(finding.observed_bp),
        observedAtto: finding.observed_atto,
        thresholdBp: Number(finding.threshold_bp),
        narrative: finding.narrative,
        consequenceApplied: finding.consequence_applied,
        txHash: writeResult.hash,
        leaderAddress,
        triggeredBy: trigger === "cron" ? "schedule" : "manual",
      });

      testedCount += 1;
      details.push({
        facilityId,
        covenantIndex,
        outcome: "tested",
        status: finding.status,
        txHash: writeResult.hash,
        message: finding.narrative,
      });
    } catch (err) {
      failedCount += 1;
      const errMsg = err instanceof Error ? err.message : String(err);
      details.push({
        facilityId,
        covenantIndex,
        outcome: "failed",
        message: errMsg,
      });
    }
  }

  // Update sweep record with results
  if (sweepId) {
    await db()
      .update(sweeps)
      .set({
        finishedAt: new Date(),
        dueCount: dueList.length,
        testedCount,
        failedCount,
        detail: details,
      })
      .where(eq(sweeps.id, sweepId));
  }

  return {
    sweepId,
    trigger,
    dueCount: dueList.length,
    testedCount,
    failedCount,
    details,
  };
}

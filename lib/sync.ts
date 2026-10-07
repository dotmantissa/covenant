/**
 * Synchronises chain state into the Neon Postgres read model.
 *
 * The chain is the source of truth for agreements, capital, and covenant findings.
 * This read cache allows the lender and borrower consoles to load instantly without
 * exhausting Studionet's rate limits.
 */
import {
  alerts,
  covenants,
  covenantTests,
  db,
  facilities,
  positions,
  type Covenant,
  type Facility,
  type Position,
} from "@/lib/db";
import { addresses, readView } from "@/lib/chain";

type RawChainFacility = {
  facility_id: string;
  lender: string;
  borrower: string;
  borrower_name: string;
  purpose: string;
  principal_atto: string;
  rate_bp: number;
  step_up_bp: number;
  created_at: string;
  status: string;
  treasury_rpc_url: string;
  treasury_address: string;
  governance_url: string;
  covenant_count: number;
};

type RawChainCovenant = {
  covenant_index: number;
  text: string;
  kind: string;
  metric: string;
  numerator_label: string;
  denominator_label: string;
  threshold_bp: number;
  threshold_atto: string;
  comparator: string;
  test_frequency_hours: number;
  cure_period_hours: number;
  filing_deadline_days: number;
  breach_consequence: string;
  source_urls: string[];
  status: string;
  observed_bp: number;
  observed_atto: string;
  evidence_ref: string;
  last_tested_at: string;
  next_due_at: string;
  cure_deadline: string;
  test_count: number;
  breach_count: number;
  appeal_status: string;
  appeal_bond_atto: string;
};

type RawChainPosition = {
  facility_id: string;
  lender: string;
  borrower: string;
  principal_atto: string;
  committed_atto: string;
  drawn_atto: string;
  repaid_atto: string;
  base_rate_bp: number;
  current_rate_bp: number;
  step_up_bp: number;
  interest_accrued_atto: string;
  draw_frozen: boolean;
  accelerated: boolean;
  opened_at: string;
  last_accrual_at: string;
  last_event_at: string;
  acceleration_started_at: string;
  enforcement_count: number;
};

/**
 * Syncs a single facility, its vault position, and its covenants from chain.
 */
export async function syncFacility(
  facilityId: string,
  createdTx?: string,
): Promise<{
  facility: Facility;
  position?: Position;
  covenants: Covenant[];
}> {
  const addrs = addresses();
  const rawFacility = await readView<RawChainFacility>(
    addrs.facilityRegistry,
    "get_facility",
    [facilityId],
  );

  const [savedFacility] = await db()
    .insert(facilities)
    .values({
      facilityId: rawFacility.facility_id,
      lenderAddress: rawFacility.lender.toLowerCase(),
      borrowerAddress: rawFacility.borrower.toLowerCase(),
      borrowerName: rawFacility.borrower_name,
      purpose: rawFacility.purpose,
      principalAtto: rawFacility.principal_atto,
      rateBp: rawFacility.rate_bp,
      stepUpBp: rawFacility.step_up_bp,
      status: rawFacility.status,
      treasuryRpcUrl: rawFacility.treasury_rpc_url,
      treasuryAddress: rawFacility.treasury_address,
      governanceUrl: rawFacility.governance_url,
      chainCreatedAt: rawFacility.created_at,
      createdTx: createdTx ?? null,
      syncedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: facilities.facilityId,
      set: {
        borrowerName: rawFacility.borrower_name,
        purpose: rawFacility.purpose,
        principalAtto: rawFacility.principal_atto,
        rateBp: rawFacility.rate_bp,
        stepUpBp: rawFacility.step_up_bp,
        status: rawFacility.status,
        treasuryRpcUrl: rawFacility.treasury_rpc_url,
        treasuryAddress: rawFacility.treasury_address,
        governanceUrl: rawFacility.governance_url,
        syncedAt: new Date(),
      },
    })
    .returning();

  if (!savedFacility) {
    throw new Error(`failed to persist facility ${facilityId}`);
  }

  // Vault position (reverts if not funded yet, so treat missing as empty position)
  let savedPosition: Position | undefined;
  try {
    const rawPos = await readView<RawChainPosition>(
      addrs.creditVault,
      "get_position",
      [facilityId],
    );

    const [pos] = await db()
      .insert(positions)
      .values({
        facilityId: rawPos.facility_id,
        committedAtto: rawPos.committed_atto,
        drawnAtto: rawPos.drawn_atto,
        accruedInterestAtto: rawPos.interest_accrued_atto,
        effectiveRateBp: rawPos.current_rate_bp,
        drawFrozen: rawPos.draw_frozen,
        accelerated: rawPos.accelerated,
        syncedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: positions.facilityId,
        set: {
          committedAtto: rawPos.committed_atto,
          drawnAtto: rawPos.drawn_atto,
          accruedInterestAtto: rawPos.interest_accrued_atto,
          effectiveRateBp: rawPos.current_rate_bp,
          drawFrozen: rawPos.draw_frozen,
          accelerated: rawPos.accelerated,
          syncedAt: new Date(),
        },
      })
      .returning();
    savedPosition = pos;
  } catch {
    // No position open on chain yet (uncommitted)
  }

  // Covenants
  const rawCovenants = await readView<RawChainCovenant[]>(
    addrs.facilityRegistry,
    "get_covenants",
    [facilityId],
  );

  const savedCovenants: Covenant[] = [];
  for (const c of rawCovenants) {
    const [saved] = await db()
      .insert(covenants)
      .values({
        facilityId,
        covenantIndex: c.covenant_index,
        text: c.text,
        kind: c.kind,
        metric: c.metric,
        numeratorLabel: c.numerator_label,
        denominatorLabel: c.denominator_label,
        thresholdBp: c.threshold_bp,
        thresholdAtto: c.threshold_atto,
        comparator: c.comparator,
        testFrequencyHours: c.test_frequency_hours,
        curePeriodHours: c.cure_period_hours,
        filingDeadlineDays: c.filing_deadline_days,
        breachConsequence: c.breach_consequence,
        sourceUrls: c.source_urls,
        status: c.status,
        observedBp: c.observed_bp,
        observedAtto: c.observed_atto,
        evidenceRef: c.evidence_ref,
        lastTestedAt: c.last_tested_at,
        nextDueAt: c.next_due_at,
        cureDeadline: c.cure_deadline,
        testCount: c.test_count,
        breachCount: c.breach_count,
        appealStatus: c.appeal_status,
        appealBondAtto: c.appeal_bond_atto,
        syncedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [covenants.facilityId, covenants.covenantIndex],
        set: {
          status: c.status,
          observedBp: c.observed_bp,
          observedAtto: c.observed_atto,
          evidenceRef: c.evidence_ref,
          lastTestedAt: c.last_tested_at,
          nextDueAt: c.next_due_at,
          cureDeadline: c.cure_deadline,
          testCount: c.test_count,
          breachCount: c.breach_count,
          appealStatus: c.appeal_status,
          appealBondAtto: c.appeal_bond_atto,
          syncedAt: new Date(),
        },
      })
      .returning();

    if (saved) savedCovenants.push(saved);
  }

  return {
    facility: savedFacility,
    position: savedPosition,
    covenants: savedCovenants,
  };
}

/**
 * Syncs all facilities known to the registry.
 */
export async function syncAllFacilities(): Promise<string[]> {
  const addrs = addresses();
  const ids = await readView<string[]>(addrs.facilityRegistry, "list_facility_ids");
  for (const id of ids) {
    await syncFacility(id);
  }
  return ids;
}

export type RecordFindingInput = {
  facilityId: string;
  covenantIndex: number;
  sequence: number;
  kind: string;
  testedAt: string;
  breached: boolean;
  status: string;
  sourceUrls: string[];
  citation: string;
  locator: string;
  asOf: string;
  numeratorMilli: string;
  denominatorMilli: string;
  observedBp: number;
  observedAtto: string;
  thresholdBp: number;
  narrative: string;
  consequenceApplied: string;
  txHash?: string;
  validatorVotes?: Record<string, string>;
  leaderAddress?: string;
  triggeredBy: "schedule" | "manual" | "api";
};

/**
 * Writes an immutable evidence row for a completed covenant test and generates
 * notifications for breach and cure status changes.
 */
export async function recordTestEvidence(input: RecordFindingInput): Promise<number> {
  const [row] = await db()
    .insert(covenantTests)
    .values({
      facilityId: input.facilityId,
      covenantIndex: input.covenantIndex,
      sequence: input.sequence,
      kind: input.kind,
      testedAt: input.testedAt,
      breached: input.breached,
      status: input.status,
      sourceUrls: input.sourceUrls,
      citation: input.citation,
      locator: input.locator,
      asOf: input.asOf,
      numeratorMilli: input.numeratorMilli,
      denominatorMilli: input.denominatorMilli,
      observedBp: input.observedBp,
      observedAtto: input.observedAtto,
      thresholdBp: input.thresholdBp,
      narrative: input.narrative,
      consequenceApplied: input.consequenceApplied,
      txHash: input.txHash ?? null,
      validatorVotes: input.validatorVotes ?? null,
      leaderAddress: input.leaderAddress ?? null,
      triggeredBy: input.triggeredBy,
    })
    .onConflictDoUpdate({
      target: [
        covenantTests.facilityId,
        covenantTests.covenantIndex,
        covenantTests.sequence,
      ],
      set: {
        narrative: input.narrative,
        consequenceApplied: input.consequenceApplied,
        txHash: input.txHash ?? null,
      },
    })
    .returning();

  const testId = row?.id;

  // Create alert entries if this was a notable state transition
  if (input.breached) {
    const isPending = input.status === "breach_pending_cure";
    await db().insert(alerts).values({
      facilityId: input.facilityId,
      covenantIndex: input.covenantIndex,
      kind: isPending ? "cure_open" : "breach",
      severity: isPending ? "warning" : "critical",
      title: isPending
        ? `Covenant #${input.covenantIndex} offside (cure window opened)`
        : `Covenant #${input.covenantIndex} breached`,
      body: input.narrative,
      testId: testId ?? null,
      audience: "both",
    });

    if (input.consequenceApplied && input.consequenceApplied !== "none") {
      await db().insert(alerts).values({
        facilityId: input.facilityId,
        covenantIndex: input.covenantIndex,
        kind: "enforcement",
        severity: "critical",
        title: `Enforcement applied: ${input.consequenceApplied.replace(/_/g, " ")}`,
        body: `Triggered by test finding: ${input.narrative}`,
        testId: testId ?? null,
        audience: "both",
      });
    }
  }

  // Refresh read cache for this facility
  await syncFacility(input.facilityId);

  return testId ?? 0;
}

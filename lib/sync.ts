/**
 * Synchronises chain state into the Neon Postgres read model.
 *
 * The chain is the source of truth for agreements, capital, and covenant findings.
 * This read cache allows the lender and borrower consoles to load instantly without
 * exhausting Studionet's rate limits.
 */
import {
  ensureDatabase,
  covenants,
  db,
  facilities,
  positions,
  type Covenant,
  type Facility,
  type Position,
} from "@/lib/db";
import { addresses, readView } from "@/lib/chain";
import { indexFacilityEvidence } from "@/lib/evidence-index";

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
  borrower_authorized: boolean;
  terms_digest: string;
  evidence_max_age_days: number;
  reporting_schedule: string;
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

let facilityIndex: { registry: string; expires: number; ids: ReadonlySet<string> } | undefined;

/** Scope the read cache to agreements actually registered in this deployment. */
export async function currentFacilityIds(): Promise<ReadonlySet<string>> {
  await ensureDatabase();
  const registry = addresses().facilityRegistry;
  if (facilityIndex?.registry === registry && facilityIndex.expires > Date.now()) {
    return facilityIndex.ids;
  }
  const ids = await readView<string[]>(registry, "list_facility_ids");
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string")) {
    throw new Error("registry returned an invalid facility index");
  }
  const indexed = new Set(ids);
  facilityIndex = { registry, expires: Date.now() + 10_000, ids: indexed };
  return indexed;
}

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
  await ensureDatabase();
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

    const quote = await readView<{interest_atto: string}>(addrs.creditVault, "quote_outstanding", [facilityId]);
    const collected = await readView<{interest_collected_atto: string}>(addrs.creditVault, "get_interest_collected", [facilityId]);
    const [pos] = await db()
      .insert(positions)
      .values({
        facilityId: rawPos.facility_id,
        committedAtto: rawPos.committed_atto,
        drawnAtto: rawPos.drawn_atto,
        accruedInterestAtto: quote.interest_atto,
        collectedInterestAtto: collected.interest_collected_atto,
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
          accruedInterestAtto: quote.interest_atto,
        collectedInterestAtto: collected.interest_collected_atto,
          effectiveRateBp: rawPos.current_rate_bp,
          drawFrozen: rawPos.draw_frozen,
          accelerated: rawPos.accelerated,
          syncedAt: new Date(),
        },
      })
      .returning();
    savedPosition = pos;
  } catch (error) {
    if (!(error instanceof Error) || !/no position open on/.test(error.message)) throw error;
  }

  // Covenants
  const rawCovenants = await readView<RawChainCovenant[]>(
    addrs.facilityRegistry,
    "get_covenants",
    [facilityId],
  );

  const enforcement = await readView<{ restrictions: { covenant_index: number; consequence: string }[] }>(addrs.covenantMonitor, "get_enforcement_state", [facilityId]);
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
        termsDigest: c.terms_digest, evidenceMaxAgeDays: c.evidence_max_age_days,
        reportingSchedule: c.reporting_schedule,
        enforcementConsequence: enforcement.restrictions.find(r => r.covenant_index === c.covenant_index)?.consequence ?? "",
        status: c.borrower_authorized ? c.status : "pending_authorization",
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
          text: c.text, kind: c.kind, metric: c.metric,
          numeratorLabel: c.numerator_label, denominatorLabel: c.denominator_label,
          thresholdBp: c.threshold_bp, thresholdAtto: c.threshold_atto,
          comparator: c.comparator, testFrequencyHours: c.test_frequency_hours,
          curePeriodHours: c.cure_period_hours, filingDeadlineDays: c.filing_deadline_days,
          breachConsequence: c.breach_consequence, sourceUrls: c.source_urls,
          termsDigest: c.terms_digest, evidenceMaxAgeDays: c.evidence_max_age_days,
          reportingSchedule: c.reporting_schedule,
          enforcementConsequence: enforcement.restrictions.find(r => r.covenant_index === c.covenant_index)?.consequence ?? "",
          status: c.borrower_authorized ? c.status : "pending_authorization",
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

  await indexFacilityEvidence(facilityId, savedCovenants);
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


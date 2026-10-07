import { handleRouteError, jsonResponse } from "@/lib/api";
import { requireActor } from "@/lib/auth";
import { clientFor, addresses, readView, sendWrite } from "@/lib/chain";
import { recordTestEvidence } from "@/lib/sync";

type RouteParams = {
  params: Promise<{ id: string; index: string }>;
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

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const actor = await requireActor(request);
    const { id: facilityId, index: indexStr } = await params;
    const covenantIndex = parseInt(indexStr, 10);

    if (isNaN(covenantIndex)) {
      return jsonResponse({ error: "invalid covenant index" }, 400);
    }

    const client = clientFor(actor.privyDid);
    const addrs = addresses();

    // Send test_covenant transaction
    const writeResult = await sendWrite(
      client,
      "test_covenant",
      addrs.covenantMonitor,
      "test_covenant",
      [facilityId, covenantIndex],
    );

    // Read finding details and test parameters from contracts
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

    const testId = await recordTestEvidence({
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
      triggeredBy: "manual",
    });

    return jsonResponse({
      testId,
      finding,
      txHash: writeResult.hash,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

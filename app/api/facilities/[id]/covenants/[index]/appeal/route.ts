import { handleRouteError, jsonResponse } from "@/lib/api";
import { requireActor } from "@/lib/auth";
import { clientFor, addresses, sendWrite } from "@/lib/chain";
import { alerts, db } from "@/lib/db";
import { syncFacility } from "@/lib/sync";

type RouteParams = {
  params: Promise<{ id: string; index: string }>;
};

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const actor = await requireActor(request);
    const { id: facilityId, index: indexStr } = await params;
    const covenantIndex = parseInt(indexStr, 10);
    const body = await request.json();

    const { bondAtto } = body;
    if (!bondAtto || BigInt(bondAtto) <= 0n) {
      return jsonResponse({ error: "bondAtto must be greater than zero" }, 400);
    }

    const client = clientFor(actor.privyDid);
    const addrs = addresses();

    const writeResult = await sendWrite(
      client,
      "appeal_breach",
      addrs.covenantMonitor,
      "appeal_breach",
      [facilityId, covenantIndex],
      BigInt(bondAtto),
    );

    // Sync from chain
    const synced = await syncFacility(facilityId);

    // Create alert for appeal opened
    await db().insert(alerts).values({
      facilityId,
      covenantIndex,
      kind: "appeal",
      severity: "warning",
      title: `Appeal opened for Covenant #${covenantIndex}`,
      body: `Borrower posted ${bondAtto} bond to dispute the finding.`,
      audience: "both",
    });

    return jsonResponse({
      facility: synced.facility,
      covenants: synced.covenants,
      txHash: writeResult.hash,
      returned: writeResult.returned,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

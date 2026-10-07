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

    const client = clientFor(actor.privyDid);
    const addrs = addresses();

    const writeResult = await sendWrite(
      client,
      "resolve_appeal",
      addrs.covenantMonitor,
      "resolve_appeal",
      [facilityId, covenantIndex],
    );

    const synced = await syncFacility(facilityId);

    const returned = writeResult.returned as
      | {
          appeal_status?: string;
          bond_atto?: string;
          bond_paid_to?: string;
          status?: string;
        }
      | undefined;

    const appealStatus = returned?.appeal_status ?? "resolved";

    await db().insert(alerts).values({
      facilityId,
      covenantIndex,
      kind: "appeal",
      severity: appealStatus === "upheld" ? "critical" : "info",
      title: `Appeal ${appealStatus} for Covenant #${covenantIndex}`,
      body: `Appeal resolved on-chain. Finding ${appealStatus}.`,
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

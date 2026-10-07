import { handleRouteError, jsonResponse } from "@/lib/api";
import { requireActor } from "@/lib/auth";
import { clientFor, addresses, sendWrite } from "@/lib/chain";
import { syncFacility } from "@/lib/sync";

type RouteParams = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const actor = await requireActor(request);
    const { id: facilityId } = await params;
    const body = await request.json();

    const { amountAtto } = body;
    if (!amountAtto || BigInt(amountAtto) <= 0n) {
      return jsonResponse({ error: "amountAtto must be greater than zero" }, 400);
    }

    const client = clientFor(actor.privyDid);
    const addrs = addresses();

    const writeResult = await sendWrite(
      client,
      "repay",
      addrs.creditVault,
      "repay",
      [facilityId],
      BigInt(amountAtto),
    );

    const synced = await syncFacility(facilityId);

    return jsonResponse({
      facility: synced.facility,
      position: synced.position,
      txHash: writeResult.hash,
      returned: writeResult.returned,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

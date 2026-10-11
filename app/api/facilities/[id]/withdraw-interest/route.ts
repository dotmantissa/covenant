import { attoInput } from "@/lib/amounts";
import { handleRouteError, jsonResponse } from "@/lib/api";
import { requireActor } from "@/lib/auth";
import { addresses, clientFor, sendWrite } from "@/lib/chain";
import { syncFacility } from "@/lib/sync";

type RouteParams = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const actor = await requireActor(request);
    const { id } = await params;
    const body = await request.json();
    const amount = attoInput(body.amountAtto ?? "0", true);
    if (amount < 0n) return jsonResponse({ error: "amount must be nonnegative" }, 400);
    const result = await sendWrite(clientFor(actor.privyDid), "withdraw_interest",
      addresses().creditVault, "withdraw_interest", [id, amount]);
    return jsonResponse({ ...(await syncFacility(id)), txHash: result.hash,
      returned: result.returned });
  } catch (error) {
    return handleRouteError(error);
  }
}

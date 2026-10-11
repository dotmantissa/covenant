import { handleRouteError, jsonResponse } from "@/lib/api";
import { requireActor } from "@/lib/auth";
import { addresses, clientFor, sendWrite, readView } from "@/lib/chain";
import { syncFacility } from "@/lib/sync";

type RouteParams = { params: Promise<{ id: string; index: string }> };

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const actor = await requireActor(request);
    const { id, index } = await params;
    const covenantIndex = Number(index);
    if (!Number.isSafeInteger(covenantIndex) || covenantIndex < 0) {
      return jsonResponse({ error: "invalid covenant index" }, 400);
    }
    const { termsDigest } = await request.json();
    const authoritative = await readView<{terms_digest: string}>(addresses().facilityRegistry, "get_covenant", [id, covenantIndex]);
    if (termsDigest !== authoritative.terms_digest) return jsonResponse({ error: "Displayed terms changed. Refresh and review before approving." }, 409);
    const result = await sendWrite(clientFor(actor.privyDid), "approve_covenant",
      addresses().facilityRegistry, "approve_covenant", [id, covenantIndex, termsDigest]);
    return jsonResponse({ ...(await syncFacility(id)), txHash: result.hash });
  } catch (error) {
    return handleRouteError(error);
  }
}

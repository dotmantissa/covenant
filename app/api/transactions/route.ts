import { requireActor } from "@/lib/auth";
import { handleRouteError,jsonResponse } from "@/lib/api";
import { pendingIntents } from "@/lib/transactions";
export async function GET(request:Request) {
  try {const actor=await requireActor(request);const facilityId=new URL(request.url).searchParams.get('facilityId')??undefined;
    return jsonResponse({transactions:await pendingIntents(actor.privyDid,facilityId)});}
  catch(error){return handleRouteError(error);}
}

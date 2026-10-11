import { requireActor } from "@/lib/auth";
import { handleRouteError,jsonResponse } from "@/lib/api";
import { pollIntent } from "@/lib/transactions";
export const maxDuration=60;
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}) {
  try {const actor=await requireActor(request);const {id}=await params;return jsonResponse(await pollIntent(id,actor.privyDid));}
  catch(error){return handleRouteError(error);}
}

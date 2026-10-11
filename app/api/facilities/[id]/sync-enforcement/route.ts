import { handleRouteError, jsonResponse } from "@/lib/api";
import { requireActor } from "@/lib/auth";
import { addresses } from "@/lib/chain";
import { submitIntent } from "@/lib/transactions";
export const maxDuration=60;
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}) {
  try {const actor=await requireActor(request);const {id}=await params;
    return jsonResponse(await submitIntent({request,actor,facilityId:id,address:addresses().covenantMonitor,method:"sync_enforcement",args:[id]}),202);}
  catch(error){return handleRouteError(error);}
}

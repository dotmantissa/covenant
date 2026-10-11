import { handleRouteError, jsonResponse } from "@/lib/api";
import { requireActor } from "@/lib/auth";
import { addresses } from "@/lib/chain";
import { submitIntent } from "@/lib/transactions";
import { integerInput } from "@/lib/amounts";
export const maxDuration=60;
export async function POST(request:Request,{params}:{params:Promise<{id:string;index:string}>}) {
  try {
    const actor=await requireActor(request);const {id,index}=await params;const covenantIndex=integerInput(index,"Covenant index");
    return jsonResponse(await submitIntent({request,actor,facilityId:id,address:addresses().covenantMonitor,method:"resolve_appeal",args:[id,covenantIndex]}),202);
  } catch(error){return handleRouteError(error);}
}

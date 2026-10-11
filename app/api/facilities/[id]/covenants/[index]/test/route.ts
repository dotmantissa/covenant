import { handleRouteError, jsonResponse } from "@/lib/api";
import { requireActor } from "@/lib/auth";
import { addresses } from "@/lib/chain";
import { submitIntent } from "@/lib/transactions";
import { integerInput } from "@/lib/amounts";
import { readView } from "@/lib/chain";
export const maxDuration=60;
export async function POST(request:Request,{params}:{params:Promise<{id:string;index:string}>}) {
  try {
    const actor=await requireActor(request);const {id,index}=await params;const covenantIndex=integerInput(index,"Covenant index");
    const facility=await readView<{lender:string;borrower:string}>(addresses().facilityRegistry,"get_facility",[id]);
    const manual=[facility.lender,facility.borrower].some(a=>a.toLowerCase()===actor.address.toLowerCase());
    return jsonResponse(await submitIntent({request,actor,facilityId:id,address:addresses().covenantMonitor,method:"test_covenant",args:[id,covenantIndex,manual]}),202);
  } catch(error){return handleRouteError(error);}
}

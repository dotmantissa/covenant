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
    const {termsDigest}=await request.json();
    const chain=await readView<{terms_digest:string}>(addresses().facilityRegistry,"get_covenant",[id,covenantIndex]);
    if(termsDigest!==chain.terms_digest)return jsonResponse({error:"Displayed terms changed. Refresh and review before approving."},409);
    return jsonResponse(await submitIntent({request,actor,facilityId:id,address:addresses().facilityRegistry,method:"approve_covenant",args:[id,covenantIndex,termsDigest]}),202);
  } catch(error){return handleRouteError(error);}
}

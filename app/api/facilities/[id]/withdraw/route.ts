import { handleRouteError, jsonResponse } from "@/lib/api";
import { requireActor } from "@/lib/auth";
import { addresses } from "@/lib/chain";
import { submitIntent } from "@/lib/transactions";
import { attoInput } from "@/lib/amounts";
export const maxDuration=60;
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}) {
  try {
    const actor=await requireActor(request);const {id}=await params;const body=await request.json();
    const amount=attoInput(body.amountAtto);
    return jsonResponse(await submitIntent({request,actor,facilityId:id,address:addresses().creditVault,method:"withdraw_free_capital",
      args:[id,amount]}),202);
  } catch(error){return handleRouteError(error);}
}

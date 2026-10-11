import { handleRouteError,jsonResponse } from "@/lib/api";
import { optionalActor,requireActor } from "@/lib/auth";
import { alerts,alertReads,db,facilities } from "@/lib/db";
import { desc,eq,inArray } from "drizzle-orm";
import { integerInput } from "@/lib/amounts";
import { receivesAlert } from "@/lib/alert-access";

export async function GET(request:Request) {
  try {
    const actor=await optionalActor(request);const allFacilities=await db().select().from(facilities);
    const visibleFacilities=actor?allFacilities.filter(f=>[f.lenderAddress,f.borrowerAddress].some(a=>a.toLowerCase()===actor.address.toLowerCase())):allFacilities;
    if(!visibleFacilities.length)return jsonResponse({alerts:[]});
    const byId=new Map(visibleFacilities.map(f=>[f.facilityId,f]));
    const rows=await db().select().from(alerts).where(inArray(alerts.facilityId,[...byId.keys()])).orderBy(desc(alerts.createdAt)).limit(100);
    const reads=actor?await db().select().from(alertReads).where(eq(alertReads.actorDid,actor.privyDid)):[];
    const readTimes=new Map(reads.map(r=>[r.alertId,r.readAt]));const unread=new URL(request.url).searchParams.get('unread')==='true';
    return jsonResponse({alerts:rows.filter(a=>!actor||receivesAlert(actor.address,byId.get(a.facilityId)!,a.audience))
      .map(a=>({...a,readAt:readTimes.get(a.id)??null})).filter(a=>!unread||!a.readAt).slice(0,50)});
  }catch(error){return handleRouteError(error);}
}
export async function POST(request:Request) {
  try {
    const actor=await requireActor(request);const body=await request.json();
    const own=(await db().select().from(facilities)).filter(f=>[f.lenderAddress,f.borrowerAddress].some(a=>a.toLowerCase()===actor.address.toLowerCase()));
    const byId=new Map(own.map(f=>[f.facilityId,f]));
    if(body.facilityId && !byId.has(body.facilityId))return jsonResponse({error:'Facility access denied.'},403);
    if(!own.length)return jsonResponse({error:'Alert access denied.'},403);
    const rows=await db().select().from(alerts).where(inArray(alerts.facilityId,body.facilityId?[body.facilityId]:[...byId.keys()]));
    const alertId=body.markAll===true?null:integerInput(body.alertId,'Alert id',1);
    const selected=rows.filter(a=>(alertId===null||a.id===alertId)&&receivesAlert(actor.address,byId.get(a.facilityId)!,a.audience));
    if(alertId!==null && !selected.length)return jsonResponse({error:'Alert access denied.'},403);
    if(selected.length)await db().insert(alertReads).values(selected.map(a=>({alertId:a.id,actorDid:actor.privyDid}))).onConflictDoNothing();
    return jsonResponse({success:true,readCount:selected.length});
  }catch(error){return handleRouteError(error);}
}

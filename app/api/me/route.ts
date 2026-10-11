import { handleRouteError,jsonResponse } from '@/lib/api';
import { requireActor } from '@/lib/auth';
import { alerts,alertReads,db,facilities } from '@/lib/db';
import { readClient } from '@/lib/chain';
import { genlayerNetwork } from '@/lib/env';
import { receivesAlert } from '@/lib/alert-access';
import { eq,inArray,or,sql } from 'drizzle-orm';
export async function GET(request:Request) {
 try {
  const actor=await requireActor(request),addr=actor.address.toLowerCase();
  const own=await db().select().from(facilities).where(or(eq(sql`lower(${facilities.lenderAddress})`,addr),eq(sql`lower(${facilities.borrowerAddress})`,addr)));
  const rows=own.length?await db().select().from(alerts).where(inArray(alerts.facilityId,own.map(f=>f.facilityId))):[];
  const reads=await db().select().from(alertReads).where(eq(alertReads.actorDid,actor.privyDid));
  const dismissed=new Set(reads.map(r=>r.alertId));
  const balance=await readClient().request({method:'eth_getBalance',params:[actor.address,'latest']});
  return jsonResponse({actor:{email:actor.email,privyDid:actor.privyDid,address:actor.address},balanceAtto:BigInt(balance as string).toString(),
   network:genlayerNetwork(),custody:'server',counts:{total:own.length,asLender:own.filter(f=>f.lenderAddress.toLowerCase()===addr).length,
   asBorrower:own.filter(f=>f.borrowerAddress.toLowerCase()===addr).length,
   unreadAlerts:rows.filter(a=>!dismissed.has(a.id)&&receivesAlert(addr,own.find(f=>f.facilityId===a.facilityId)!,a.audience)).length}});
 }catch(error){return handleRouteError(error);}
}

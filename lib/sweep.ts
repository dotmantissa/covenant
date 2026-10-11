/** A bounded durable scheduler pass: resume one saved transaction or submit one due test. */
import { createHash,randomUUID } from "node:crypto";
import { addresses,readView } from "@/lib/chain";
import { db,ensureDatabase,sweeps,type SweepDetail } from "@/lib/db";
import { acquireLock,releaseLock,pendingIntents,pollIntent,submitIntent } from "@/lib/transactions";
import { deriveAddress } from "@/lib/signer";
import { eq } from "drizzle-orm";

export type DueCovenant={facility_id:string;covenant_index:number;kind:string;metric:string;next_due_at:string;status:string;action?:string};
export type SweepResult={sweepId:number;trigger:"cron"|"manual";dueCount:number;testedCount:number;failedCount:number;details:SweepDetail[];locked?:boolean};
export async function runSweep(options:{trigger?:"cron"|"manual";signerDid?:string}={}):Promise<SweepResult> {
  await ensureDatabase();const trigger=options.trigger??'cron';const holder=randomUUID();
  if(!await acquireLock('scheduler',holder,90))return {sweepId:0,trigger,dueCount:0,testedCount:0,failedCount:0,details:[],locked:true};
  const [record]=await db().insert(sweeps).values({trigger,detail:[]}).returning();
  if(!record){await releaseLock('scheduler',holder);throw new Error('Could not record scheduler pass.');}
  const result:SweepResult={sweepId:record.id,trigger,dueCount:0,testedCount:0,failedCount:0,details:[]};
  try {
    const did=options.signerDid??'did:privy:covenant_scheduler';
    const pending=(await pendingIntents(did)).filter(p=>p.status!=='settlement_failed');
    if(pending.length) {
      const saved=pending[0]!;const updated=await pollIntent(saved.intentId,did);
      result.testedCount=updated.status==='confirmed'?1:0;
      result.failedCount=['failed','reverted','settlement_failed'].includes(updated.status)?1:0;
      result.details.push({facilityId:saved.facilityId,covenantIndex:0,outcome:result.testedCount?'tested':result.failedCount?'failed':'pending',txHash:updated.txHash??undefined,message:updated.error??updated.status});
    }else {
      const due=await readView<DueCovenant[]>(addresses().facilityRegistry,'due_covenants');result.dueCount=due.length;
      const item=due[0];
      if(item) {
        const method=item.action==='resolve_appeal'?'resolve_appeal':'test_covenant';
        const requestKey=createHash('sha256').update(`${method}:${item.facility_id}:${item.covenant_index}:${item.next_due_at}:${Math.floor(Date.now()/300000)}`).digest('hex');
        const intent=await submitIntent({request:new Request('https://scheduler.local',{headers:{'Idempotency-Key':requestKey}}),actor:{privyDid:did,address:deriveAddress(did)},
          facilityId:item.facility_id,address:addresses().covenantMonitor,method,args:[item.facility_id,item.covenant_index]});
        result.details.push({facilityId:item.facility_id,covenantIndex:item.covenant_index,outcome:'pending',txHash:intent.txHash??undefined,message:intent.status});
      }
    }
    await db().update(sweeps).set({finishedAt:new Date(),dueCount:result.dueCount,testedCount:result.testedCount,failedCount:result.failedCount,detail:result.details}).where(eq(sweeps.id,record.id));
    return result;
  }catch(error){await db().update(sweeps).set({finishedAt:new Date(),error:error instanceof Error?error.message:'Scheduler failed.'}).where(eq(sweeps.id,record.id));throw error;}
  finally{await releaseLock('scheduler',holder);}
}

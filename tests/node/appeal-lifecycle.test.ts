import assert from "node:assert/strict";
import { test } from "node:test";
import { waitForIntent,recoverAndRefresh,canAppeal,type PendingIntent } from "../../lib/client-transactions";

test("reload polls the stored appeal transaction, refreshes chain ruling and leaves appealed state",async()=>{
  const saved:PendingIntent={intentId:'stored-intent',facilityId:'facility',label:'resolve_appeal',status:'pending',txHash:'0xstoredhash',error:null};
  let ui={appealStatus:'open',accelerated:true,drawFrozen:true};let observations=0;let refreshed=false;
  const calls:string[]=[];
  const request=(async(url:string)=>{
    calls.push(url);observations++;
    return new Response(JSON.stringify({...saved,status:observations<2?'pending':'confirmed'}),{status:200});
  }) as typeof fetch;
  await recoverAndRefresh(saved,item=>waitForIntent<PendingIntent>(item,'actor-token',request,async()=>{},seen=>{
    assert.equal(seen.txHash,'0xstoredhash');
  }),async()=>{
    assert.equal(observations,2);refreshed=true;calls.push('refresh-authoritative-chain');
    return {appealStatus:'overturned',accelerated:false,drawFrozen:false};
  },state=>{ui=state;});
  assert.deepEqual(calls,['/api/transactions/stored-intent','/api/transactions/stored-intent','refresh-authoritative-chain']);
  assert(refreshed);assert.equal(ui.appealStatus,'overturned');assert(!ui.accelerated&&!ui.drawFrozen);
});
test("a failed appeal preserves current rights and shows the settlement failure",async()=>{
  const saved={intentId:'failed',facilityId:'facility',label:'resolve_appeal',status:'settlement_failed',txHash:'0xhash',error:'Bond transfer was not credited.'};
  let refreshes=0;
  await assert.rejects(()=>recoverAndRefresh(saved,item=>waitForIntent<PendingIntent>(item,null),async()=>{refreshes++;return {};},()=>{}),/Bond transfer was not credited/);
  assert.equal(refreshes,0);
});
test("clean ordinary retest cannot hide appeal of outstanding acceleration",()=>{
  assert(canAppeal({status:'compliant',appealStatus:'none',enforcementConsequence:'acceleration'}));
  assert(!canAppeal({status:'compliant',appealStatus:'none',enforcementConsequence:''}));
  assert(!canAppeal({status:'breached',appealStatus:'open',enforcementConsequence:'acceleration'}));
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { broadcastOnce } from "../../lib/intent-engine";
import { decodeContractResult,inspectSettlement } from "../../lib/chain";

test("crash after broadcast replays persisted bytes without new signing",async()=>{
  const row={signedTransaction:null as string|null,txHash:null as string|null};let signCount=0;const events:string[]=[];
  const submit=async(save:(raw:string)=>Promise<void>)=>{signCount++;await save('0xoriginal');events.push('broadcast');throw Error('response lost');};
  await assert.rejects(()=>broadcastOnce(row,submit,async()=>'',async(raw)=>{events.push('persist');row.signedTransaction=raw;},async()=>''));
  assert.deepEqual(events,['persist','broadcast']);
  const result=await broadcastOnce(row,submit,async raw=>{assert.equal(raw,'0xoriginal');return '0xknown';},async()=>{throw Error('must not sign');},async hash=>{row.txHash=hash;return hash;});
  assert.equal(result,'0xknown');assert.equal(signCount,1);
  await broadcastOnce(row,submit,async()=>{throw Error('must not broadcast');},async()=>{},async hash=>hash);
  assert.equal(signCount,1);
});
test("journal failure prevents the network broadcast",async()=>{
  let broadcasts=0;
  await assert.rejects(()=>broadcastOnce({signedTransaction:null,txHash:null},async save=>{await save('0xraw');broadcasts++;return '0xhash';},async()=>'',async()=>{throw Error('DB unavailable');},async()=>''));
  assert.equal(broadcasts,0);
});
test("actual saved appeal receipt decodes its terminal ruling",()=>{
  const evidence=JSON.parse(readFileSync('evidence/studionet-review.json','utf8'));
  const result=decodeContractResult(evidence.steps['appeal/resolve'].receipt.consensus_data.leader_receipt[0].result) as {appeal_status:string};
  assert.equal(result.appeal_status,'overturned');
});
test("bounded settlement observation stays pending until every descendant finalizes",async()=>{
  const parent={statusName:'FINALIZED',resultName:'MAJORITY_AGREE',consensus_data:{leader_receipt:[{execution_result:'SUCCESS'}]}};
  let finalized=false;const client={getTransaction:async({hash}:{hash:string})=>hash==='0xparent'?parent:finalized?parent:{statusName:'ACCEPTED'},getTriggeredTransactionIds:async({hash}:{hash:string})=>hash==='0xparent'?['0xchild']:[]} as never;
  assert.equal(await inspectSettlement(client,'0xparent' as never,'draw'),null);finalized=true;
  assert.deepEqual(await inspectSettlement(client,'0xparent' as never,'draw'),parent);
});

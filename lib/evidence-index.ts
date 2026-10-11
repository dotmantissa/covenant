import { alerts,covenantTests,evidenceCursors,testReceipts,db,type Covenant } from '@/lib/db';
import { addresses,readView,readClient,assertExecuted,decodeContractResult } from '@/lib/chain';
import { matchesSnapshot,returnedFinding } from '@/lib/evidence-proof';
import { transactionsStatusNumberToName, type GenLayerTransaction } from 'genlayer-js/types';
import { and,eq,inArray } from 'drizzle-orm';

type Snapshot=Record<string,unknown>&{facility_id:string;covenant_index:number;sequence:number};
const text=(s:Snapshot,key:string)=>String(s[key]??'');
const number=(s:Snapshot,key:string)=>Number(s[key]??0);
/** One bounded history page per refresh; retries cannot rewrite findings or duplicate alerts. */
export async function indexFacilityEvidence(facilityId:string,covenants:Covenant[]):Promise<void> {
  const [cursor]=await db().select().from(evidenceCursors).where(eq(evidenceCursors.facilityId,facilityId));
  const page=await readView<{tests:Snapshot[];next_sequence:number;total:number}>(addresses().covenantMonitor,'list_tests',[cursor?.sequence??0,100]);
  for(const s of page.tests.filter(s=>s.facility_id===facilityId)) {
    const covenant=covenants.find(c=>c.covenantIndex===s.covenant_index);
    if(!covenant)throw new Error('History references an unknown covenant');
    const [inserted]=await db().insert(covenantTests).values({facilityId,covenantIndex:s.covenant_index,sequence:s.sequence,
      kind:text(s,'kind'),testedAt:text(s,'tested_at'),breached:Boolean(s.breached),status:text(s,'status'),
      sourceUrls:covenant.sourceUrls,citation:text(s,'citation'),locator:text(s,'locator'),asOf:text(s,'as_of'),
      numeratorMilli:text(s,'numerator_milli'),denominatorMilli:text(s,'denominator_milli'),observedBp:number(s,'observed_bp'),
      observedAtto:text(s,'observed_atto'),thresholdBp:number(s,'threshold_bp'),narrative:text(s,'narrative'),
      consequenceApplied:text(s,'consequence_applied'),contentHash:text(s,'content_hash'),chainSnapshot:s,
      appealStatus:text(s,'appeal_status')||'none',triggeredBy:'api'}).onConflictDoNothing().returning();
    const [existing]=inserted?[inserted]:await db().select().from(covenantTests).where(and(eq(covenantTests.facilityId,facilityId),eq(covenantTests.sequence,s.sequence),eq(covenantTests.covenantIndex,s.covenant_index)));
    if(!existing)throw new Error('Evidence insert was not persisted');
    // Notifications use the immutable test identity, including successful appeal resolution.
    if(s.breached||s.under_appeal||(text(s,'consequence_applied')&&text(s,'consequence_applied')!=='none')) {
      const appeal=Boolean(s.under_appeal),pending=s.status==='breach_pending_cure';
      await db().insert(alerts).values({facilityId,covenantIndex:s.covenant_index,testId:existing.id,
        kind:appeal?'appeal':pending?'cure_open':'breach',severity:appeal?'info':pending?'warning':'critical',
        title:appeal?`Appeal ${text(s,'appeal_status')}`:`Covenant #${s.covenant_index}: ${text(s,'status')}`,
        body:text(s,'narrative'),audience:'both'}).onConflictDoNothing();
    }
  }
  await db().insert(evidenceCursors).values({facilityId,sequence:page.next_sequence}).onConflictDoUpdate({target:evidenceCursors.facilityId,set:{sequence:page.next_sequence}});
  await indexReceipts(facilityId);
}
let lastScan=0;
async function indexReceipts(facilityId:string):Promise<void> {
  // Source snapshots always progress; receipt enrichment is separately retryable.
  if(Date.now()-lastScan<20_000)return;
  const transactions=await readClient().request({method:'sim_getTransactionsForAddress',params:[addresses().covenantMonitor]}) as unknown as Record<string,unknown>[];
  const snapshots=await db().select().from(covenantTests).where(eq(covenantTests.facilityId,facilityId));
  const hashes=transactions.map(t=>String(t.hash??''));
  const saved=hashes.length?await db().select().from(testReceipts).where(inArray(testReceipts.txHash,hashes)):[];
  const known=new Set(saved.map(r=>r.txHash));
  for(const raw of transactions) {
    if(raw.status!=='FINALIZED'&&(transactionsStatusNumberToName as Record<number,string>)[Number(raw.status)]!=='FINALIZED')continue;
    const hash=String(raw.hash??'');if(known.has(hash)||!/^0x[0-9a-f]{64}$/i.test(hash))continue;
    const receipt=raw as unknown as GenLayerTransaction;
    try {assertExecuted('historical adjudication',receipt);} catch {continue;}
    const returned=decodeContractResult(receipt.consensus_data?.leader_receipt?.[0]?.result);
    const finding=returnedFinding(returned);if(!finding||finding.facility_id!==facilityId)continue;
    const original=snapshots.find(s=>s.sequence===finding.sequence&&s.covenantIndex===finding.covenant_index);
    if(!original?.chainSnapshot)continue;
    if(!matchesSnapshot(returned,original.chainSnapshot))throw new Error('Receipt does not match the immutable chain adjudication');
    const consensus=raw.consensus_data as {votes?:Record<string,string>;leader_receipt?:{node_config?:{address?:string}}[]};
    await db().insert(testReceipts).values({txHash:hash,sequence:original.sequence,facilityId,covenantIndex:original.covenantIndex,
      validatorVotes:consensus.votes??{},leaderAddress:consensus.leader_receipt?.[0]?.node_config?.address??null,receipt:raw}).onConflictDoNothing();
  }
  lastScan=Date.now();
}

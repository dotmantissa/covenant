import { db,testReceipts,type CovenantTest } from '@/lib/db';
import { inArray } from 'drizzle-orm';
/** Proof enrichment never mutates the original consensus snapshot. */
export async function withReceiptProof(rows:CovenantTest[]) {
  const receipts=rows.length?await db().select().from(testReceipts).where(inArray(testReceipts.sequence,rows.map(r=>r.sequence))):[];
  return rows.map(row=>{
    const proof=receipts.find(r=>r.sequence===row.sequence&&r.facilityId===row.facilityId&&r.covenantIndex===row.covenantIndex);
    return {...row,txHash:proof?.txHash??null,validatorVotes:proof?.validatorVotes??null,leaderAddress:proof?.leaderAddress??null,
      proofStatus:proof?'matched_finalized_receipt':'receipt_index_pending',explorerUrl:proof?`https://explorer-studio.genlayer.com/tx/${proof.txHash}`:null};
  });
}

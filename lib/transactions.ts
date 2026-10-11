import { createHash, randomUUID } from "node:crypto";
import { Interface, keccak256, type InterfaceAbi } from "ethers";
import { and, eq, notInArray, sql } from "drizzle-orm";
import type { TransactionHash } from "genlayer-js/types";
import { InvalidInput } from "@/lib/amounts";
import { clientFor, readClient, inspectSettlement, decodeContractResult, ContractRevert, SettlementFailure } from "@/lib/chain";
import { db, ensureDatabase, transactionIntents as intents, operationLocks, type TransactionIntent } from "@/lib/db";
import { syncFacility } from "@/lib/sync";
import type { Actor } from "@/lib/auth";
import { broadcastOnce } from "@/lib/intent-engine";

const terminal = ["confirmed","reverted","failed","settlement_failed"];
export function publicIntent(row: TransactionIntent) {
  return { intentId:row.id, facilityId:row.facilityId, label:row.label, status:row.status,
    txHash:row.txHash, error:row.error, returned:row.returned, createdAt:row.createdAt };
}
export async function acquireLock(key: string, holder: string, seconds = 90): Promise<boolean> {
  const [lock] = await db().insert(operationLocks).values({key,holder,expiresAt:new Date(Date.now()+seconds*1000)})
    .onConflictDoUpdate({target:operationLocks.key,set:{holder,expiresAt:sql`now() + ${seconds} * interval '1 second'`},
      setWhere:sql`${operationLocks.expiresAt} < now()`}).returning();
  return !!lock;
}
export async function releaseLock(key: string, holder: string): Promise<void> {
  await db().delete(operationLocks).where(and(eq(operationLocks.key,key),eq(operationLocks.holder,holder)));
}
async function patch(id: string, data: Partial<typeof intents.$inferInsert>): Promise<TransactionIntent> {
  const [row]=await db().update(intents).set({...data,updatedAt:new Date()}).where(eq(intents.id,id)).returning();
  if(!row) throw new Error("transaction journal disappeared");return row;
}
export async function actorIntent(id: string, actorDid: string): Promise<TransactionIntent> {
  const [row]=await db().select().from(intents).where(and(eq(intents.id,id),eq(intents.actorDid,actorDid))).limit(1);
  if(!row)throw new InvalidInput("transaction intent not found");return row;
}

/** Recover an identical signed EVM envelope; its hash and nonce cannot change. */
async function replaySigned(row: TransactionIntent): Promise<string> {
  const client=readClient();
  const broadcastHash=await client.sendRawTransaction({serializedTransaction:row.signedTransaction as `0x${string}`});
  await patch(row.id,{broadcastHash});
  const receipt=await client.request({method:"eth_getTransactionReceipt",params:[broadcastHash]}) as unknown as {
    status?: string; logs?: {topics:string[];data:string}[];
  } | null;
  if(!receipt)throw new Error("broadcast transaction is awaiting its receipt");
  if(receipt.status==='0x0')throw new ContractRevert("Signed transaction was reverted before consensus",row.label);
  const abi=client.chain.consensusMainContract?.abi;
  if(abi) {
    const decoder=new Interface(abi as unknown as InterfaceAbi);
    for(const log of receipt.logs ?? []) {
      try {const event=decoder.parseLog(log);if(event && ["NewTransaction","CreatedTransaction"].includes(event.name)) return String(event.args.txId);}
      catch { /* Other logs carry no consensus transaction id. */ }
    }
  }
  // Studio may expose its intelligent-contract ledger directly instead of EVM logs.
  if(client.chain.isStudio) {
    const native=await client.request({method:"eth_getTransactionByHash",params:[broadcastHash]}) as unknown as {to_address?:string};
    if(native?.to_address?.toLowerCase()===row.address.toLowerCase())return broadcastHash;
  }
  throw new Error("Consensus transaction id has not been indexed yet");
}

export async function submitIntent(input: { request:Request; actor:Pick<Actor,"privyDid"|"address">; facilityId:string;
  address:`0x${string}`; method:string; args:unknown[]; value?:bigint }) {
  await ensureDatabase();
  const key=input.request.headers.get("Idempotency-Key");
  if(!key || !/^[a-zA-Z0-9:_-]{16,128}$/.test(key)) throw new InvalidInput("A valid Idempotency-Key is required.");
  const fingerprint=createHash("sha256").update(JSON.stringify([input.address,input.method,input.args,(input.value??0n).toString()],
    (_key,value)=>typeof value==='bigint'?{integer:value.toString()}:value)).digest("hex");
  const lock=`actor:${input.actor.privyDid}`,holder=randomUUID();
  if(!await acquireLock(lock,holder))throw new InvalidInput("An account transaction is being prepared. Resume the pending operation.");
  try {
    let [row]=await db().select().from(intents).where(and(eq(intents.actorDid,input.actor.privyDid),eq(intents.requestKey,key))).limit(1);
    if(row && row.fingerprint!==fingerprint)throw new InvalidInput("Idempotency key belongs to different transaction terms.");
    if(!row) {
      const pending=await db().select().from(intents).where(and(eq(intents.actorDid,input.actor.privyDid),notInArray(intents.status,terminal))).limit(1);
      if(pending.length)throw new InvalidInput("A previous transaction remains pending. Resume it before signing another operation.");
      [row]=await db().insert(intents).values({id:randomUUID(),actorDid:input.actor.privyDid,requestKey:key,fingerprint,
        facilityId:input.facilityId,label:input.method,address:input.address,status:"preparing",
        payload:JSON.parse(JSON.stringify({args:input.args,value:(input.value??0n).toString()},(_key,value)=>typeof value==='bigint'?{integer:value.toString()}:value))}).returning();
    }
    if(!row)throw new Error("could not persist transaction intent");
    if(terminal.includes(row.status) || row.txHash)return {...publicIntent(row),pending:!terminal.includes(row.status)};
    const journal=row;
    try {
      await broadcastOnce(journal,
        async beforeBroadcast => clientFor(input.actor.privyDid,raw=>beforeBroadcast(raw)).writeContract({address:input.address,
          functionName:input.method,args:input.args as never[],value:input.value??0n}),
        () => replaySigned(journal),
        async raw => {await patch(journal.id,{signedTransaction:raw,broadcastHash:keccak256(raw),status:"signed",error:null});},
        hash => patch(journal.id,{txHash:hash,status:"submitted",error:null}));
    } catch(error) {
      const fresh=await actorIntent(journal.id,input.actor.privyDid);
      if(!fresh.signedTransaction)await patch(journal.id,{status:"failed",error:"Transaction preparation failed before signing."});
      else await patch(journal.id,{error:error instanceof ContractRevert?error.message:"Submission is being recovered from its saved signed transaction."});
    }
    return {...publicIntent(await actorIntent(journal.id,input.actor.privyDid)),pending:true};
  } finally {await releaseLock(lock,holder);}
}

/** One bounded observation per request; never re-signs and never sleeps for finality. */
export async function pollIntent(id: string, actorDid: string) {
  let row=await actorIntent(id,actorDid);
  if(["reverted","failed","settlement_failed"].includes(row.status))return publicIntent(row);
  const key=`intent:${id}`,holder=randomUUID();
  if(!await acquireLock(key,holder))return publicIntent(row);
  const actorLock=`actor:${actorDid}`;
  if(!await acquireLock(actorLock,holder)){await releaseLock(key,holder);return publicIntent(row);}
  try {
    if(!row.txHash && !row.signedTransaction) {
      const args=JSON.parse(JSON.stringify(row.payload.args),(_key,value)=>value && typeof value==='object' && 'integer' in value?BigInt(value.integer):value);
      await broadcastOnce(row,async beforeBroadcast=>clientFor(actorDid,raw=>beforeBroadcast(raw)).writeContract({
        address:row.address as `0x${string}`,functionName:row.label,args:args as never[],value:BigInt(row.payload.value)}),
        ()=>replaySigned(row),async raw=>{await patch(id,{signedTransaction:raw,broadcastHash:keccak256(raw),status:"signed"});},
        hash=>patch(id,{txHash:hash,status:"submitted",error:null}));
      row=await actorIntent(id,actorDid);
    }
    if(!row.txHash && row.signedTransaction) {
      row=await patch(id,{txHash:await replaySigned(row),status:"submitted",error:null});
    }
    if(!row.txHash)return publicIntent(row);
    let receipt;
    try { receipt=await inspectSettlement(readClient(),row.txHash as TransactionHash,row.label); }
    catch(error) {
      if(error instanceof ContractRevert || error instanceof SettlementFailure) {
        const childFailure=error instanceof SettlementFailure;
        return publicIntent(await patch(id,{status:childFailure?"settlement_failed":"reverted",error:error.message}));
      }
      throw error;
    }
    if(!receipt)return publicIntent(await patch(id,{status:"pending",error:null}));
    const returned=decodeContractResult(receipt.consensus_data?.leader_receipt?.[0]?.result);
    row=await patch(id,{status:"refresh_pending",returned,error:null});
    const synced=await syncFacility(row.facilityId,row.label==='create_facility'?row.txHash??undefined:undefined);
    row=await patch(id,{status:"confirmed",error:null});
    return {...publicIntent(row),...synced};
  } catch {
    return publicIntent(await patch(id,{error:"Awaiting chain settlement or state refresh. This operation remains saved; do not submit a new payment."}));
  } finally {await releaseLock(key,holder);await releaseLock(actorLock,holder);}
}
export async function pendingIntents(actorDid: string, facilityId?: string) {
  return (await db().select().from(intents).where(and(eq(intents.actorDid,actorDid),notInArray(intents.status,["confirmed","reverted","failed"]),
    facilityId?eq(intents.facilityId,facilityId):undefined))).map(publicIntent);
}

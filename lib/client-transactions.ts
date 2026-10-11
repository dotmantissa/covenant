/** Browser recovery uses saved intent ids/hashes; it never submits a replacement payment. */
export type PendingIntent = {intentId:string;facilityId:string;label:string;status:string;txHash:string|null;error:string|null};
export class IntentExecutionError extends Error {
  constructor(message:string,readonly status:string) {super(message);this.name='IntentExecutionError';}
}
export async function waitForIntent<T>(intent:PendingIntent, token:string|null|undefined,
  request:typeof fetch=fetch, pause:(ms:number)=>Promise<void>=ms=>new Promise(resolve=>setTimeout(resolve,ms)),
  onObserved?:(intent:PendingIntent)=>void, signal?:AbortSignal):Promise<T> {
  let current=intent;
  while(true) {
    if(signal?.aborted)throw new Error("Polling cancelled; transaction remains saved.");
    onObserved?.(current);
    if(['failed','reverted','settlement_failed'].includes(current.status))throw new IntentExecutionError(current.error??'Transaction execution failed.',current.status);
    if(current.status==='confirmed')return current as T;
    await pause(3000);
    const response=await request(`/api/transactions/${encodeURIComponent(current.intentId)}`,{
      headers:token?{Authorization:`Bearer ${token}`}:{},cache:'no-store',signal});
    if(!response.ok)throw new Error(`Transaction remains saved as ${current.intentId}; reconnect to resume polling.`);
    current=await response.json() as PendingIntent;
  }
}
export function canAppeal(c:{status:string;appealStatus:string;enforcementConsequence:string}):boolean {
  return c.appealStatus!=='open' && (['breach_pending_cure','breached'].includes(c.status)||c.enforcementConsequence==='acceleration');
}

/** A terminal receipt is followed by authoritative facility refresh before leaving appeal UI. */
export async function recoverAndRefresh<T>(intent:PendingIntent, poll:(intent:PendingIntent)=>Promise<PendingIntent>,
  refresh:()=>Promise<T>, apply:(state:T)=>void):Promise<T> {
  const settled=await poll(intent);
  if(settled.status!=='confirmed')throw new Error('Settlement is still pending.');
  const state=await refresh();apply(state);return state;
}

/** Browser recovery uses saved intent ids/hashes; it never submits a replacement payment. */
export type PendingIntent = {intentId:string;facilityId:string;label:string;status:string;txHash:string|null;error:string|null};
export async function waitForIntent<T>(intent:PendingIntent, token:string|null|undefined,
  request:typeof fetch=fetch, pause:(ms:number)=>Promise<void>=ms=>new Promise(resolve=>setTimeout(resolve,ms)),
  onObserved?:(intent:PendingIntent)=>void):Promise<T> {
  let current=intent;
  while(true) {
    onObserved?.(current);
    if(['failed','reverted','settlement_failed'].includes(current.status))throw new Error(current.error??'Transaction execution failed.');
    if(current.status==='confirmed')return current as T;
    await pause(3000);
    const response=await request(`/api/transactions/${encodeURIComponent(current.intentId)}`,{
      headers:token?{Authorization:`Bearer ${token}`}:{},cache:'no-store'});
    if(!response.ok)throw new Error(`Transaction remains saved as ${current.intentId}; reconnect to resume polling.`);
    current=await response.json() as PendingIntent;
  }
}
export function canAppeal(c:{status:string;appealStatus:string;enforcementConsequence:string}):boolean {
  return c.appealStatus!=='open' && (['breach_pending_cure','breached'].includes(c.status)||c.enforcementConsequence==='acceleration');
}

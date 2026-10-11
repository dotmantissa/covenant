import { randomUUID } from 'node:crypto';
import { requireActor } from '@/lib/auth';
import { handleRouteError,jsonResponse } from '@/lib/api';
import { readClient } from '@/lib/chain';
import { genlayerNetwork } from '@/lib/env';
import { acquireLock } from '@/lib/transactions';
export async function POST(request:Request) {
 try {
  const actor=await requireActor(request);
  if(genlayerNetwork()!=='studionet')return jsonResponse({error:'Demo funding is available only on Studionet.'},400);
  // Keep this lease after ambiguous RPC failure: never automatically duplicate a mint.
  if(!await acquireLock(`demo-funding:${actor.privyDid}`,randomUUID(),86400))return jsonResponse({error:'A test funding request is already recorded within the last 24 hours. Refresh your balance.'},429);
  const hash=await readClient().request({method:'sim_fundAccount',params:[actor.address,100*10**18]});
  return jsonResponse({hash,amountAtto:'100000000000000000000',notice:'100 test GEN requested. Refresh balance before committing funds.'});
 }catch(error){return handleRouteError(error);}
}

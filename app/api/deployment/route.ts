import {createHash} from 'node:crypto';
import {NextResponse} from 'next/server';
import {readClient,readView,addresses} from '@/lib/chain';
import {genlayerNetwork} from '@/lib/env';
import {deploymentId} from '@/lib/deployment';
import {privy} from '@/lib/privy';
import manifest from '@/deploy/addresses.json';
let cached:{expires:number;result:unknown}|undefined;
export const maxDuration=60;
export async function GET(){
 try{
  if(cached&&cached.expires>Date.now())return NextResponse.json(cached.result);
  const contracts=addresses();
  const checks=await Promise.all(Object.entries(contracts).map(async([key,address])=>{
   const [source,wiring]=await Promise.all([readClient().request({method:'gen_getContractCode',params:[address]}),readView<Record<string,unknown>>(address,'get_wiring')]);
   const digest=createHash('sha256').update(Buffer.from(source as string,'base64')).digest('hex');
   const expected=manifest.sourceHashes[key as keyof typeof manifest.sourceHashes];
   const peers=key==='facilityRegistry'?{monitor:contracts.covenantMonitor,vault:contracts.creditVault}:key==='covenantMonitor'?{registry:contracts.facilityRegistry,vault:contracts.creditVault}:{registry:contracts.facilityRegistry,monitor:contracts.covenantMonitor};
   const matchedPeers=Object.entries(peers).every(([name,want])=>String(wiring[name]).toLowerCase()===want.toLowerCase());
   if(digest!==expected||!wiring.wiring_sealed||!matchedPeers)throw Error('Deployment source or sealed wiring verification failed');
   return [key,{address,sourceSha256:digest,sealed:true}];
  }));
  const required=['DATABASE_URL','NEXT_PUBLIC_PRIVY_APP_ID','PRIVY_APP_SECRET','SIGNER_MASTER_SECRET','CRON_SECRET'];
  const configuration=Object.fromEntries(required.map(key=>[key,Boolean(process.env[key])]));
  if(Object.values(configuration).some(present=>!present))throw Error('Required deployment configuration is missing');
  // Exercise the protected credentials against the actual identity provider.
  const [verificationKey,settings]=await Promise.all([privy().getVerificationKey(),privy().getAppSettings()]);
  if(!verificationKey||!settings)throw Error('Identity provider verification failed');
  const result={network:genlayerNetwork(),deploymentId:deploymentId(),revision:process.env.VERCEL_GIT_COMMIT_SHA??null,verifiedAt:new Date().toISOString(),contracts:Object.fromEntries(checks),configuration,authentication:{credentialsVerified:true}};
  cached={expires:Date.now()+30000,result};return NextResponse.json(result);
 }catch{return NextResponse.json({error:'Deployment source, authority or configuration verification is unavailable.'},{status:503});}
}

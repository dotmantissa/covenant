'use client';
import { useCallback,useEffect,useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { apiFetch } from '@/lib/client-api';
import { formatAtto } from '@/lib/format';
import Link from 'next/link';
type Account={actor:{email:string;address:string};balanceAtto:string;network:string};
export default function AccountPage(){
 const {ready,authenticated,login,getAccessToken}=usePrivy();
 const [account,setAccount]=useState<Account|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 const refresh=useCallback(async()=>{setError('');try{setAccount(await apiFetch<Account>('/api/me',{},await getAccessToken()));}catch(e){setError(e instanceof Error?e.message:'Account refresh failed.');}},[getAccessToken]);
 useEffect(()=>{if(ready&&authenticated)void refresh();},[ready,authenticated,refresh]);
 async function fund(){setBusy(true);setError('');try{const result=await apiFetch<{notice:string}>('/api/me/fund',{method:'POST'},await getAccessToken());setNotice(result.notice);await refresh();}catch(e){setError(e instanceof Error?e.message:'Funding request failed.');}finally{setBusy(false);}}
 return <div className="max-w-3xl mx-auto space-y-5"><h1 className="font-serif text-3xl">Your GenLayer account</h1>
 <p>Email sign-in uses a server-controlled signing account. This application is a Studionet demonstration with test GEN. Keep the server signing secret backed up; it controls these accounts.</p>
 {ready&&!authenticated&&<button onClick={login}>Sign in with email</button>}
 {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
 {account&&<><p>{account.actor.email}</p><p>Network: {account.network}</p><p className="font-mono break-all">{account.actor.address}</p>
 <button onClick={()=>void navigator.clipboard.writeText(account.actor.address).catch(()=>setError('Copy failed; select the address above.'))}>Copy address</button>
 <p>Native balance: {formatAtto(account.balanceAtto)}</p><button disabled={busy} onClick={()=>void refresh()}>Refresh balance</button>
 {account.network==='studionet'&&<button disabled={busy} onClick={()=>void fund()} className="ml-4 underline">Request 100 test GEN</button>}
 <p>Test funding is limited to one request per account every 24 hours. Native commitments, repayments and appeal bonds need this balance even though transaction submission is gasless.</p>
 <Link href="/facilities" className="underline">Open your facilities</Link></>}
 </div>;
}

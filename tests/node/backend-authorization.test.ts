import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { receivesAlert } from "../../lib/alert-access";
import { isCronAuthorized } from "../../lib/cron-auth";

function route(path:string,dependencies:Record<string,unknown>) {
  const runtime={exports:{}};
  const code=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  runInNewContext(code,{module:runtime,exports:runtime.exports,Request,Response,URL,console,
    require:(name:string)=>{assert(name in dependencies,`missing stub ${name}`);return dependencies[name];}});
  return runtime.exports as {POST:(request:Request)=>Promise<Response>;GET:(request:Request)=>Promise<Response>};
}
test("actual alert handler rejects cross-user dismissal and markAll writes only recipient receipts",async()=>{
  const facilities={name:'facilities'},alerts={name:'alerts',facilityId:'facilityId',createdAt:'createdAt'},alertReads={name:'reads',actorDid:'actorDid'};
  const tables:Record<string,Record<string,unknown>[]>= {
    facilities:[{facilityId:'A',lenderAddress:'0xlenderA',borrowerAddress:'0xborrowerA'},{facilityId:'B',lenderAddress:'0xlenderB',borrowerAddress:'0xborrowerB'}],
    alerts:[{id:1,facilityId:'A',audience:'both',readAt:null},{id:2,facilityId:'B',audience:'both',readAt:null}],reads:[],
  };
  let actor={privyDid:'did:A',address:'0xlenderA'};
  const db=()=>({select:()=>({from:(table:{name:string})=>{
    let predicate=(row:Record<string,unknown>)=>!!row;
    const query={where:(next:typeof predicate)=>{predicate=next;return query;},orderBy:()=>query,limit:()=>query,
      then:(resolve:(rows:Record<string,unknown>[])=>unknown)=>Promise.resolve(tables[table.name]!.filter(predicate)).then(resolve)};
    return query;
  }}),insert:(table:{name:string})=>({values:(rows:Record<string,unknown>[])=>({onConflictDoNothing:async()=>{
    for(const row of rows)if(!tables[table.name]!.some(r=>r.alertId===row.alertId&&r.actorDid===row.actorDid))tables[table.name]!.push({...row,readAt:new Date()});
  }})})});
  const handlers=route('app/api/alerts/route.ts',{
    '@/lib/api':{jsonResponse:(data:unknown,status=200)=>new Response(JSON.stringify(data),{status}),handleRouteError:()=>new Response(null,{status:500})},
    '@/lib/auth':{requireActor:async()=>actor,optionalActor:async()=>actor},'@/lib/db':{db,facilities,alerts,alertReads},
    'drizzle-orm':{eq:(field:string,value:unknown)=>(row:Record<string,unknown>)=>row[field]===value,inArray:(field:string,values:unknown[])=>(row:Record<string,unknown>)=>values.includes(row[field]),desc:()=>null},
    '@/lib/amounts':{integerInput:(value:unknown)=>Number(value)},'@/lib/alert-access':{receivesAlert},
  });
  const post=(body:unknown)=>handlers.POST(new Request('https://app/api/alerts',{method:'POST',body:JSON.stringify(body)}));
  assert.equal((await post({alertId:2})).status,403);
  assert.equal((await post({facilityId:'B',markAll:true})).status,403);
  assert.equal((await post({markAll:true})).status,200);
  assert.equal(tables.reads!.length,1);assert.equal(tables.reads![0]!.alertId,1);assert.equal(tables.alerts![0]!.readAt,null);
  actor={privyDid:'did:borrowerA',address:'0xborrowerA'};
  const response=await handlers.GET(new Request('https://app/api/alerts?unread=true'));
  const body=await response.json() as {alerts:{id:number;readAt:unknown}[]};
  assert.equal(body.alerts.length,1);assert.equal(body.alerts[0]!.id,1);assert.equal(body.alerts[0]!.readAt,null);
});
test("actual sweep mutation rejects anonymous callers before executing signer work",async()=>{
  let executions=0;process.env.CRON_SECRET='a'.repeat(64);
  const handlers=route('app/api/sweep/route.ts',{
    '@/lib/api':{jsonResponse:(data:unknown,status=200)=>new Response(JSON.stringify(data),{status}),handleRouteError:()=>new Response(null,{status:500})},
    '@/lib/db':{},'@/lib/sweep':{runSweep:async()=>{executions++;return{};}},'@/lib/cron-auth':{isCronAuthorized},'drizzle-orm':{},
  });
  assert.equal((await handlers.POST(new Request('https://app/api/sweep'))).status,401);assert.equal(executions,0);
  assert.equal((await handlers.POST(new Request('https://app/api/sweep',{headers:{authorization:`Bearer ${process.env.CRON_SECRET}`}}))).status,200);
  assert.equal(executions,1);delete process.env.CRON_SECRET;
});

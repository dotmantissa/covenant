import {test,expect,type Page} from '@playwright/test';
import {build} from 'esbuild';
import {createServer,type Server} from 'node:http';
let server:Server,base:string;
test.beforeEach(async({page})=>{page.on('pageerror',error=>console.error('Browser component error:',error.message));});
test.beforeAll(async()=>{
 const result=await build({stdin:{contents:`import React,{Suspense} from 'react';import {createRoot} from 'react-dom/client';import Console from './app/facilities/[id]/page';import Account from './app/account/page';import Facilities from './app/facilities/page';const params=Promise.resolve({id:'browser-facility'});createRoot(document.getElementById('root')).render(<Suspense fallback="Loading">{location.pathname==='/account'?<Account/>:location.pathname==='/facilities'?<Facilities/>:<Console params={params}/>}</Suspense>);`,resolveDir:process.cwd(),loader:'tsx'},jsx:'automatic',bundle:true,write:false,format:'iife',platform:'browser',define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'test-auth-and-navigation',setup(b){
  b.onResolve({filter:/^(@privy-io\/react-auth|next\/link)$/},args=>({path:args.path,namespace:'browser-test'}));
  b.onLoad({filter:/.*/,namespace:'browser-test'},args=>({resolveDir:process.cwd(),loader:'tsx',contents:args.path==='next/link'?`export default function Link({children,...props}){return <a {...props}>{children}</a>}`:`const token=async()=>localStorage.getItem('actor')||'borrower';export function usePrivy(){return {ready:true,authenticated:true,getAccessToken:token,login(){}};}`}));
 }}]});
 const bundle=result.outputFiles[0]!.text;
 server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/bundle.js'?'application/javascript':'text/html');res.end(req.url==='/bundle.js'?bundle:'<div id="root"></div><script src="/bundle.js"></script>');});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();if(!address||typeof address==='string')throw Error('server address');base=`http://127.0.0.1:${address.port}`;
});
test.afterAll(async()=>{await new Promise<void>(resolve=>server.close(()=>resolve()));});
const lender='0x1111111111111111111111111111111111111111',borrower='0x2222222222222222222222222222222222222222';
function state(actor='borrower',appeal='open') {const restored=appeal==='overturned';return {actorAddress:actor==='lender'?lender:borrower,facility:{facilityId:'browser-facility',lenderAddress:lender,borrowerAddress:borrower,borrowerName:'Email borrower',purpose:'Working capital',principalAtto:'100000000000000000000',rateBp:850,stepUpBp:400,status:restored?'active':'accelerating',treasuryRpcUrl:'',treasuryAddress:'',governanceUrl:'',chainCreatedAt:'2026-10-01T00:00:00Z',syncedAt:'2026-10-11T00:00:00Z',lenderEmail:'lender@example.com',borrowerEmail:'borrower@example.com'},position:{committedAtto:'100000000000000000000',drawnAtto:'10000000000000000000',accruedInterestAtto:'1000',collectedInterestAtto:'0',effectiveRateBp:850,drawFrozen:!restored,accelerated:!restored},covenants:[{covenantIndex:0,text:'No new senior debt',kind:'prose',metric:'Debt',numeratorLabel:'',denominatorLabel:'',thresholdBp:0,thresholdAtto:'0',comparator:'gte',testFrequencyHours:24,curePeriodHours:0,filingDeadlineDays:0,breachConsequence:'acceleration',sourceUrls:['https://example.com/report'],status:restored?'compliant':'breached',observedBp:0,observedAtto:'0',evidenceRef:'report',lastTestedAt:'2026-10-11T00:00:00Z',nextDueAt:'2026-10-12T00:00:00Z',cureDeadline:'',testCount:restored?2:1,breachCount:1,appealStatus:appeal,appealBondAtto:'1000000000000000000',termsDigest:'signed-terms',enforcementConsequence:restored?'':'acceleration',evidenceMaxAgeDays:120,reportingSchedule:''}],tests:[],alerts:[]};}
const saved={intentId:'stored-appeal',facilityId:'browser-facility',label:'resolve_appeal',status:'pending',txHash:`0x${'a'.repeat(64)}`,error:null};
async function respond(page:Page,handler:(url:URL,method:string,body:unknown)=>unknown){await page.route('**/api/**',async route=>{const req=route.request();await route.fulfill({json:handler(new URL(req.url()),req.method(),req.postData()?JSON.parse(req.postData()!):null)});});}
test('actual facility page reload polls stored appeal, refreshes ruling and restores draw rights',async({page})=>{
 let polls=0,refreshes=0,posts=0;await respond(page,(url,method)=>{if(method==='POST')posts++;if(url.pathname==='/api/transactions')return {transactions:[saved]};if(url.pathname==='/api/transactions/stored-appeal'){polls++;return {...saved,status:polls<2?'pending':'confirmed'};}if(url.searchParams.get('refresh')==='true'){refreshes++;return state('borrower','overturned');}return state();});
 await page.goto(base);await expect(page.getByRole('button',{name:'Draw Capital'})).toBeDisabled();await expect(page.getByText('Appeal Open',{exact:false})).toBeVisible();
 await expect(page.getByRole('button',{name:'Draw Capital'})).toBeEnabled({timeout:15000});await expect(page.getByText('Appeal Open',{exact:false})).toHaveCount(0);await expect(page.getByRole('button',{name:'Resolve',exact:true})).toHaveCount(0);expect(polls).toBe(2);expect(refreshes).toBe(1);expect(posts).toBe(0);
 await page.reload();await expect(page.getByRole('button',{name:'Draw Capital'})).toBeEnabled({timeout:10000});expect(posts).toBe(0);
});
test('actual failed appeal displays bond failure and keeps draw restrictions',async({page})=>{
 let refreshed=false;await respond(page,url=>{if(url.searchParams.get('refresh'))refreshed=true;if(url.pathname==='/api/transactions')return {transactions:[{...saved,status:'settlement_failed',error:'Bond transfer was not credited.'}]};return state();});
 await page.goto(base);await expect(page.getByText('Bond transfer was not credited.',{exact:false}).first()).toBeVisible();await expect(page.getByRole('button',{name:'Draw Capital'})).toBeDisabled();expect(refreshed).toBe(false);await expect(page.getByRole('button',{name:'Repair enforcement delivery'})).toBeVisible();
});
test('lender signs the exact decimal amount displayed by the actual capital modal',async({page})=>{
 let submitted:Record<string,unknown>|null=null;await page.addInitScript(()=>localStorage.setItem('actor','lender'));
 await respond(page,(url,method,body)=>{if(url.pathname==='/api/transactions')return {transactions:[]};if(method==='POST'){submitted=body as Record<string,unknown>;return {...saved,intentId:'commit',label:'commit',status:'confirmed'};}return state('lender','overturned');});
 await page.goto(base);await page.getByRole('button',{name:'Commit Capital'}).click();await page.locator('input[type=number]').fill('0.29');await expect(page.getByText('0.29 GEN',{exact:false})).toBeVisible();await page.getByRole('button',{name:'Confirm commit',exact:true}).click();await expect.poll(()=>submitted?.amountAtto).toBe('290000000000000000');
});
test('email account page shows owned address and exact native balance, then refreshes test funding',async({page})=>{
 let funds=0;await respond(page,(url,method)=>{if(url.pathname==='/api/me/fund'&&method==='POST'){funds++;return {notice:'100 test GEN requested.'};}return {actor:{email:'borrower@example.com',address:borrower},network:'studionet',balanceAtto:funds?'100290000000000000000':'290000000000000000'};});
 await page.goto(`${base}/account`);await expect(page.getByText(borrower,{exact:true})).toBeVisible();await expect(page.getByText('Native balance: 0.29 GEN')).toBeVisible();await page.getByRole('button',{name:'Request 100 test GEN'}).click();await expect(page.getByText('Native balance: 100.29 GEN')).toBeVisible();expect(funds).toBe(1);
});

test('lender drafts an agreement for a registered borrower email using the actual facility form',async({page})=>{
 let submission:Record<string,unknown>|null=null;await page.addInitScript(()=>localStorage.setItem('actor','lender'));
 await respond(page,(_url,method,body)=>{if(method==='POST'){submission=body as Record<string,unknown>;return {...saved,status:'confirmed',label:'create_facility'};}return {facilities:[]};});
 await page.goto(`${base}/facilities`);await page.getByRole('button',{name:'Draft Facility',exact:true}).click();
 await page.getByPlaceholder('FAC-2026-001').fill('email-facility');await page.getByPlaceholder('Acme Operations LLC').fill('Borrower');
 await page.getByLabel('Borrower email').fill('borrower@example.com');await page.getByRole('button',{name:'Sign & Create Agreement'}).click();
 await expect.poll(()=>submission?.borrowerEmail).toBe('borrower@example.com');expect((submission as Record<string,unknown>|null)?.borrowerAddress).toBe('');
});
test('borrower signs exactly the covenant digest displayed from the current deployment',async({page})=>{
 let payload:Record<string,unknown>|null=null;
 await respond(page,(url,method,body)=>{if(url.pathname==='/api/transactions')return {transactions:[]};if(method==='POST'){payload=body as Record<string,unknown>;return {...saved,status:'confirmed',label:'approve_covenant'};}const detail=state('borrower','none');detail.covenants[0]!.status='pending_authorization';detail.covenants[0]!.enforcementConsequence='';return detail;});
 await page.goto(base);await page.getByRole('button',{name:'Approve Terms'}).click();await expect.poll(()=>payload?.termsDigest).toBe('signed-terms');
});

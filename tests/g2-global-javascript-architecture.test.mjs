import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {patchRoute,routeParams,routeValue,subscribeRoute,workspaceRouteFilters,patchWorkspaceFilters,ROUTE_CHANGE_EVENT} from '../src/lib/route-state.ts';
import {ApiRequestError,parseApiResponse,getJson,isAbortedRequest} from '../src/lib/api-client.ts';

const read=path=>readFile(new URL('../'+path,import.meta.url),'utf8');
function mockBrowser(path='/?view=payments&stage=payment&period=2026-09&paymentPanel=FUNDING#test'){
 const previous=globalThis.window;
 const listeners=new EventTarget();
 let href=new URL(path,'https://proqpay.test').href;
 const calls=[];
 const win={location:{get href(){return href},get search(){return new URL(href).search}},
  history:{state:{unrelated:'preserve'},pushState(state,unused,url){href=String(url);this.state=state;calls.push('push');},replaceState(state,unused,url){href=String(url);this.state=state;calls.push('replace');}},
  addEventListener:(...args)=>listeners.addEventListener(...args),
  removeEventListener:(...args)=>listeners.removeEventListener(...args),
  dispatchEvent:event=>listeners.dispatchEvent(event),
 };
 Object.defineProperty(globalThis,'window',{value:win,configurable:true,writable:true});
 return{win,calls,url:()=>new URL(href),restore(){if(previous===undefined)delete globalThis.window;else globalThis.window=previous;}};
}

test('G2 URL patch preserves period, payment deep link, fragment and unrelated history state',()=>{
 const b=mockBrowser();try{
  let signals=0;
  const unsub=subscribeRoute(()=>signals++);
  assert.equal(patchRoute({fundingAccountId:'REG-0190',clientId:'CLIENT X'}),true);
  assert.equal(b.url().searchParams.get('fundingAccountId'),'REG-0190');
  assert.equal(b.url().searchParams.get('clientId'),'CLIENT X');
  assert.equal(b.url().searchParams.get('period'),'2026-09');
  assert.equal(b.url().searchParams.get('paymentPanel'),'FUNDING');
  assert.equal(b.url().hash,'#test');
  assert.deepEqual(b.win.history.state,{unrelated:'preserve'});
  assert.equal(b.calls.at(-1),'replace');
  assert.equal(signals,1);
  assert.equal(patchRoute({clientId:'CLIENT X'}),false,'no redundant navigation events');
  assert.equal(signals,1);
  patchRoute({view:'billing',stage:'close',paymentPanel:null,fundingAccountId:null},'push',{view:'billing',period:'2026-09'});
  assert.equal(b.calls.at(-1),'push');
  assert.equal(signals,2);
  assert.equal(b.url().searchParams.get('fundingAccountId'),null);
  assert.equal(b.url().searchParams.get('stage'),'close');
  assert.equal(b.url().searchParams.get('period'),'2026-09');
  b.win.dispatchEvent(new Event('popstate'));
  assert.equal(signals,3);
  unsub();patchRoute({clientId:null});assert.equal(signals,3);
 }finally{b.restore();}
});

test('G2 client switch retains selected project until explicit reset and preserves payment/funding query',()=>{
 const b=mockBrowser('/?view=payments&stage=payment&clientId=C1&projectId=P1&q=lag&fundingAccountId=0190');try{
  assert.deepEqual(workspaceRouteFilters(),{clientId:'C1',projectId:'P1',query:'lag'});
  const next=patchWorkspaceFilters(workspaceRouteFilters(),{clientId:'C2'});
  assert.deepEqual(next,{clientId:'C2',projectId:'P1',query:'lag'});
  assert.equal(routeValue('projectId'),'P1');
  assert.equal(routeValue('clientId'),'C2');
  assert.equal(routeValue('fundingAccountId'),'0190');
  assert.equal(routeValue('stage'),'payment');
  const search=patchWorkspaceFilters(next,{query:'  '});
  assert.equal(search.query,'  ');assert.equal(routeValue('q'),null);
  const cleared=patchWorkspaceFilters(search,{clientId:'ALL',projectId:'ALL'});
  assert.equal(cleared.projectId,'ALL');assert.equal(routeValue('clientId'),null);
  assert.equal(routeParams().get('view'),'payments');
 }finally{b.restore();}
});

test('G2 route update is safe for SSR and unknown deep-link parameters',()=>{
 assert.equal(typeof globalThis.window,'undefined');
 assert.equal(patchRoute({view:'payments'}),false);
 assert.equal(routeValue('period'),null);
 assert.deepEqual(workspaceRouteFilters(),{clientId:'ALL',projectId:'ALL',query:''});
 const unsub=subscribeRoute(()=>{throw new Error('SSR must not invoke')});unsub();
 assert.equal(ROUTE_CHANGE_EVENT,'proqpay:route-change');
});

test('G2 shared API normalizes HTTP errors, status, code and correlation without retries',async()=>{
 for(const status of [401,403,409,429,500,502]){
  await assert.rejects(parseApiResponse(new Response(JSON.stringify({error:'Controlled failure',code:'CONTROLLED',correlationId:'corr-g2'}),{status,headers:{'Content-Type':'application/json'}})),e=>{
   assert(e instanceof ApiRequestError);assert.equal(e.status,status);assert.equal(e.message,'Controlled failure');
   assert.equal(e.code,'CONTROLLED');assert.equal(e.correlationId,'corr-g2');return true;
  });
 }
 const body=await parseApiResponse(new Response(JSON.stringify({ok:true,records:[1,2]}),{status:200}));
 assert.deepEqual(body,{ok:true,records:[1,2]});
 assert.equal(await parseApiResponse(new Response(null,{status:204})),undefined);
 await assert.rejects(parseApiResponse(new Response('invalid json',{status:200})),/INVALID_API_RESPONSE/);
 await assert.rejects(parseApiResponse(new Response('failure',{status:502})),e=>e instanceof ApiRequestError&&e.status===502);
});

test('G2 shared GET honors AbortSignal/custom Headers and never retries failed request',async()=>{
 const previous=globalThis.fetch;let count=0;const controller=new AbortController();
 globalThis.fetch=async(_url,options)=>{count++;assert.equal(options.signal,controller.signal);assert.equal(new Headers(options.headers).get('Accept'),'application/json');return new Response(JSON.stringify({code:'DOWN',error:'Gateway unavailable'}),{status:502})};
 try{await assert.rejects(getJson('/api/test',{signal:controller.signal,headers:new Headers({'X-Test':'g2'})}),e=>e instanceof ApiRequestError&&e.status===502);assert.equal(count,1);}
 finally{globalThis.fetch=previous;}
 assert.equal(isAbortedRequest(Object.assign(new Error('cancelled'),{name:'AbortError'})),true);
 assert.equal(isAbortedRequest(new Error('STALE_ACTOR_CONTEXT')),true);
 assert.equal(isAbortedRequest(new Error('HTTP 500')),false);
});

test('G2 single URL contract and async loader safety are integrated in all financial workspace tiers',async()=>{
 const [home,unified,operations,funding,api,monitor,gateway,audit,directory,dashboard]=await Promise.all([
  read('src/app/page.tsx'),read('src/components/UnifiedPayrollWorkspace.tsx'),read('src/components/OperatingWorkspace.tsx'),read('src/components/E2PayFundingLimitControl.tsx'),read('src/lib/operating-model-api.ts'),read('src/lib/integration-monitor-api.ts'),read('src/lib/payment-gateway-api.ts'),read('src/components/SystemLogs.tsx'),read('src/components/DirectoryManager.tsx'),read('src/components/PayrollControlTower.tsx'),
 ]);
 assert.match(home,/patchRoute\(\{view:safeView,period,/);assert.match(home,/subscribeRoute\(onPopState\)/);
 assert.doesNotMatch(home,/window\.history\.pushState|window\.history\.replaceState/);
 assert.match(unified,/patchWorkspaceFilters\(filters,patch\)/);
 assert.match(unified,/Klien terpilih \(tidak tersedia\)/);
 assert.match(unified,/Reset filter/);
 assert.match(unified,/subscribeRoute\(onRoute\)/);
 assert.doesNotMatch(unified,/window\.history\.pushState|window\.history\.replaceState/);
 assert.match(operations,/const generation=\+\+requestGeneration\.current/);
 assert.match(operations,/if\(!current\(\)\)return/);
 assert.match(operations,/requestGeneration\.current\+=1/);
 assert.match(operations,/setUatArchiveVerified\(false\)/);
 assert.match(operations,/patchRoute\(\{paymentPanel:next\}\)/);
 assert.match(funding,/setClientId\(e\.target\.value\)/);
 assert.match(funding,/getE2PayDisbursementLimits\(\)/);
 assert.match(api,/const parseResponse=parseApiResponse/);
 assert.match(monitor,/parseApiResponse<IntegrationMonitorResponse>/);
 assert.match(gateway,/const parseResponse=parseApiResponse/);
 assert.match(audit,/activeLoad\.current\?\.abort\(\)/);
 assert.match(audit,/signal:controller\.signal/);
 assert.match(directory,/activeDirectoryRequest\.current\?\.abort\(\)/);
 assert.match(directory,/if\(!current\(\)\)return/);
 assert.match(dashboard,/patchRoute\(\{submissionId:submissionId\|\|null/);
 // Maker/checker MFA paths must retain their original security step-up.
 assert.match(api,/fetchWithSecurityStepUp\('\/api\/operating-model'/);
 assert.match(gateway,/fetchWithSecurityStepUp\('\/api\/payment-gateway'/);
});

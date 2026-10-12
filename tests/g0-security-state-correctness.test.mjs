import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const src = async path => readFile(new URL(`../${path}`, import.meta.url),'utf8');
async function transpiled(path,injected={},globals={}){
 const source=await src(path);
 const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const exports={};const fakeRequire=(name)=>{if(Object.hasOwn(injected,name))return injected[name];throw new Error('Unmocked import '+name)};
 new Function('exports','require',...Object.keys(globals),compiled)(exports,fakeRequire,...Object.values(globals));
 return exports;
}
function browser(){
 const store=new Map();let writes=0;
 const localStorage={getItem:k=>store.get(k)||null,setItem:(k,v)=>{writes++;store.set(k,String(v));},removeItem:k=>store.delete(k)};
 return{window:{localStorage,dispatchEvent:()=>true},localStorage,store,get writes(){return writes;}};
}

test('G0 payroll and employee browser mirrors are removed, never re-persisted, and unauthorized views are empty',async()=>{
 const b=browser();b.localStorage.setItem('proqpay_db_v3',JSON.stringify({employees:[{name:'PRIVATE EMPLOYEE',nik:'123'}]}));
 b.localStorage.setItem('proqpay_db_v2','private-old-payroll');
 b.localStorage.setItem('proqpay_settings_v3','user-visible-preferences');
 const session=await transpiled('src/lib/session.ts',{}, {window:b.window});
 const system=await transpiled('src/lib/system-log.ts',{}, {window:b.window,crypto:{randomUUID:()=> 'log-id'}});
 const db=await transpiled('src/lib/database.ts',{'./session':session,'./system-log':system},{window:b.window});
 assert.equal(db.loadDatabase().employees.length,0);
 assert.equal(b.store.has('proqpay_db_v3'),false);
 assert.equal(b.store.has('proqpay_db_v2'),false);
 assert.equal(db.saveDatabase({employees:[{name:'private'}]}),false);
 assert.equal(db.databaseActorScope(),null);
 const userA={id:'A',role:'PAYROLL_PROCESSOR',orgId:'ORG1',clientIds:['CLIENT1']};
 db.setDatabaseActor(userA);
 assert.equal(db.saveDatabase({employees:[{name:'USER A PRIVATE'}]}),true);
 assert.equal(db.loadDatabase().employees[0].name,'USER A PRIVATE');
 assert.equal(b.store.has('proqpay_db_v3'),false);
 assert.equal(b.store.get('proqpay_settings_v3'),'user-visible-preferences');
 const scopeA=db.databaseActorScope();
 db.setDatabaseActor({id:'B',role:'PAYROLL_CONTROLLER',orgId:'ORG2',clientIds:['CLIENT2']});
 assert.equal(db.loadDatabase().employees.length,0,'user B must not see user A cache');
 assert.equal(db.saveDatabase({employees:[{name:'OLD INFLIGHT A'}]},scopeA),false);
 assert.equal(db.loadDatabase().employees.length,0,'old in-flight fetch must not restore data');
 const scopeB=db.databaseActorScope();
 assert.notEqual(scopeA,scopeB);
 assert.equal(db.saveDatabase({employees:[{name:'USER B PRIVATE'}]},scopeB),true);
 db.setDatabaseActor({id:'B',role:'PAYROLL_CONTROLLER',orgId:'ORG2',clientIds:['CLIENT3']});
 assert.equal(db.loadDatabase().employees.length,0,'client grant changes also invalidate the mirror');
 db.clearDatabaseMirror();
 db.setDatabaseActor(userA);
 assert.notEqual(db.databaseActorScope(),scopeA,'same account new session must have distinct generation');
 assert.equal(db.saveDatabase({employees:[{name:'STALE PREVIOUS LOGIN'}]},scopeA),false);
 assert.equal(db.loadDatabase().employees.length,0);
 db.clearDatabaseMirror();
 assert.equal(db.loadDatabase().employees.length,0);
 assert.equal(db.databaseActorScope(),null);
 assert.equal(b.store.has('proqpay_db_v3'),false);
});

test('G0 IDA session and operational logs are volatile; persistent copies are purged',async()=>{
 const b=browser();b.localStorage.setItem('proqpay_ida_session','sess-previous-user');b.localStorage.setItem('proqpay_system_logs_v1','[{"private":"PII"}]');
 const session=await transpiled('src/lib/session.ts',{}, {window:b.window,crypto:{randomUUID:()=> 'new-session'}});
 const system=await transpiled('src/lib/system-log.ts',{}, {window:b.window,crypto:{randomUUID:()=> 'log-id'}});
 assert.equal(session.getIdaSessionId(),'sess-new-session');
 assert.equal(b.store.has('proqpay_ida_session'),false);
 assert.deepEqual(system.loadSystemLogs(),[]);
 system.writeSystemLog('INFO','SECURITY','TEST','PII not persisted');
 assert.equal(system.loadSystemLogs().length,1);
 assert.equal(b.store.has('proqpay_system_logs_v1'),false);
 session.clearIdaSessionId();system.clearSystemLogs();
 assert.equal(system.loadSystemLogs().length,0);
});

test('G0 IDA intent explicitly refuses all legacy payroll/approval/invoice mutations, even with confirmation',async()=>{
 const stub=new Proxy({},{get:(_target,name)=>name==='renderMarkdown'?(x=>x):name==='formatIDR'?(n=>String(n)):name==='loadSettings'?(()=>({})):name==='buildSharedContext'?(()=>({})):name==='orchestrateRequest'?(()=>({allowed:false,plan:{risk:'FINANCIAL'}})):name==='writeSystemLog'?(()=>{}):()=>{throw new Error('Forbidden legacy call '+String(name))}});
 const imports=['./database','./format','./margin','./markdown','./wilayah','./payroll-validate','./bpjs-calc','./app-settings','./ida-os/orchestrator','./ida-os/read-workers','./system-log','./ida-os/payroll-preview','./ida-os/payroll-query'];
 const mocks=Object.fromEntries(imports.map(p=>[p,stub]));
 const local=await transpiled('src/lib/ida-simple.ts',mocks);
 const db={meta:{currentPeriod:'2026-09'},payrolls:[{id:'P1',period:'2026-09',status:'CALCULATED'}],invoices:[],approvals:[]};
 const original=JSON.stringify(db);
 for(const request of ['hitung payroll','buat payroll','konfirmasi payroll TOKEN','ajukan approval','konfirmasi approval TOKEN','setujui payroll','buat invoice','terbit invoice','invoice']){
  const result=local.handleIdaIntent(request,db,{currentRole:'SUPER_ADMIN',currentUser:{email:'admin@example.test'}},{confirmedPayrollPlanId:'TOKEN',confirmedApprovalPlanId:'TOKEN'});
  assert.match(result.reply,/canonical|workflow|Pay Runs|Billing & AR|tidak/i,request);
  assert.equal(result.dbChanged,undefined,request);
  assert.equal(result.newDb,undefined,request);
  assert.equal(result.payrollPlanExecuted,undefined,request);
  assert.equal(result.approvalPlanExecuted,undefined,request);
  assert.equal(JSON.stringify(db),original,request);
 }
});

test('G0 legacy state persistence API client fails closed without network request',async()=>{
 const client=await transpiled('src/lib/cloudflare-sync.ts');
 await assert.rejects(client.persistBusinessState({payrolls:[{status:'APPROVED'}]}),/LEGACY_STATE_WRITE_DISABLED/);
});

test('G0 caller sites clear state on logout/401 and gate late async responses to current actor',async()=>{
 const main=await src('src/app/page.tsx');
 const logOut=await src('src/components/AppHeader.tsx');
 const refresh=await src('src/hooks/useVisibilityAwareCanonicalRefresh.ts');
 const ida=await src('src/components/IdaFab.tsx');
 assert.match(main,/setDatabaseActor\(authenticatedActor\)/);
 assert.match(main,/if\(saveDatabase\(canonical,authenticatedScope\)\)setDb\(canonical\)/);
 assert.match(main,/setOperatingCacheActor\(null\);\s*clearDatabaseMirror\(\)/);
 assert.match(logOut,/clearDatabaseMirror\(\);\s*clearIdaSessionId\(\);\s*clearSystemLogs\(\);\s*setOperatingCacheActor\(null\)/);
 assert.match(refresh,/if\(saveDatabase\(canonical,scope\)\)onDatabase\(canonical\)/);
 assert.match(ida,/if\(!saveDatabase\(result.db,actorScope\)\)return/);
 assert.doesNotMatch(ida,/persistBusinessState\(result.newDb\)/);
 assert.match(ida,/IDA_LEGACY_MUTATION_REJECTED/);
});

test('G0 D1 mirror sync fails closed on directory/state/service plan HTTP 500 rather than claiming success',async()=>{
 const mirror=await transpiled('src/lib/cloudflare-sync.ts');
 const previousFetch=globalThis.fetch;
 const response=(body,status=200)=>({ok:status>=200&&status<300,status,json:async()=>body});
 const makeFetch=(statusByEndpoint={})=>async url=>{
   const key=url.startsWith('/api/employees')?'employees':url.startsWith('/api/client-projects')?'directory':url.startsWith('/api/state')?'state':'plans';
   if(key==='employees')return response({employees:[],meta:{nextOffset:null}},statusByEndpoint.employees||200);
   if(key==='directory')return response({clients:[],projects:[]},statusByEndpoint.directory||200);
   if(key==='state')return response({state:{payrolls:[],approvals:[],invoices:[],arMonitor:[],auditLogs:[]}},statusByEndpoint.state||200);
   return response({servicePlans:[]},statusByEndpoint.plans||200);
 };
 try{
  globalThis.fetch=makeFetch({state:500});
  await assert.rejects(mirror.syncDatabaseFromCloudflare({meta:{}}),/CANONICAL_STATE_SYNC_FAILED: HTTP 500/);
  globalThis.fetch=makeFetch({directory:500});
  await assert.rejects(mirror.syncDatabaseFromCloudflare({meta:{}}),/DIRECTORY_SYNC_FAILED: HTTP 500/);
  globalThis.fetch=makeFetch({plans:500});
  await assert.rejects(mirror.syncDatabaseFromCloudflare({meta:{}}),/SERVICE_PLAN_SYNC_FAILED: HTTP 500/);
  globalThis.fetch=makeFetch({state:403,plans:403});
  assert.equal((await mirror.syncDatabaseFromCloudflare({meta:{}})).synced,true,'valid role restrictions still permitted');
 }finally{globalThis.fetch=previousFetch;}
});

test('G0 cached operating API responses cannot be reused across role grants, organization or late in-flight requests',async()=>{
 const cached=await transpiled('src/lib/operating-model-api.ts',{'./security-step-up':{fetchWithSecurityStepUp:()=>{throw new Error('No mutation allowed')}},'./api-client':{parseApiResponse:response=>response.json()}});
 const original=globalThis.fetch;
 const pending=[];
 let calls=0;
 globalThis.fetch=()=>{calls++;return new Promise(resolve=>pending.push(resolve));};
 const actorA={id:'USER-1',role:'CLIENT_USER',orgId:'ORG-A',clientIds:['C-A']};
 const actorB={id:'USER-1',role:'CLIENT_USER',orgId:'ORG-B',clientIds:['C-B']};
 try{
  cached.setOperatingCacheActor(actorA);
  const old=cached.listOperatingResource('submissions');
  cached.setOperatingCacheActor(actorB);
  const current=cached.listOperatingResource('submissions');
  assert.equal(calls,2,'different organization/grants cannot share response cache');
  pending[0](new Response(JSON.stringify({submissions:[{owner:'ORG-A'}]})));
  await assert.rejects(old,/STALE_ACTOR_CONTEXT/);
  pending[1](new Response(JSON.stringify({submissions:[{owner:'ORG-B'}]})));
  assert.equal((await current).submissions[0].owner,'ORG-B');
  assert.equal((await cached.listOperatingResource('submissions')).submissions[0].owner,'ORG-B');
  assert.equal(calls,2,'same verified actor should reuse short-lived cache');
  cached.setOperatingCacheActor(actorA);
  const refreshed=cached.listOperatingResource('submissions');
  assert.equal(calls,3,'stale in-flight A result must not resurrect across B -> A');
  pending[2](new Response(JSON.stringify({submissions:[{owner:'NEW ORG-A'}]})));
  assert.equal((await refreshed).submissions[0].owner,'NEW ORG-A');
 }finally{globalThis.fetch=original;cached.setOperatingCacheActor(null);}
});

test('G0 /api/me supplies tenant identity for client cache and mirror scoping',async()=>{
 const code=await src('functions/api/me.js');
 assert.match(code,/orgId: actor\.orgId \|\| null/);
 const cache=await src('src/lib/operating-model-api.ts');
 assert.match(cache,/cacheGeneration\+=1/);
 assert.match(cache,/generation!==cacheGeneration/);
 assert.match(cache,/orgId:actor\.orgId\|\|''/);
});

import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
import {ApiRequestError,parseApiResponse,AUTHENTICATION_REQUIRED_EVENT} from '../src/lib/api-client.ts';

const source=await readFile(new URL('../src/components/BillingWorkspace.tsx',import.meta.url),'utf8');
const ast=ts.createSourceFile('BillingWorkspace.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
function functionUnderTest(name,dependencies){
 let found;
 function visit(node){if(ts.isFunctionDeclaration(node)&&node.name?.text===name)found=node;ts.forEachChild(node,visit);}
 visit(ast);assert.ok(found,`missing ${name}`);
 const compiled=ts.transpileModule(`${found.getText(ast)}\nexport {${name}};`,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const exports={};new Function('exports',...Object.keys(dependencies),compiled)(exports,...Object.values(dependencies));return exports[name];
}
const response=(status,body)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
function fixture(t,name,replies){
 const oldWindow=globalThis.window;const events=new EventTarget();globalThis.window=events;
 t.after(()=>{if(oldWindow===undefined)delete globalThis.window;else globalThis.window=oldWindow;});
 const state={requests:[],notices:[],loads:0,logins:0};
 events.addEventListener(AUTHENTICATION_REQUIRED_EVENT,()=>state.logins++);
 const action=functionUnderTest(name,{
  fetch:async(url,init)=>{state.requests.push({url,init});assert.ok(replies.length,'unexpected request/replay');return replies.shift();},
  load:async()=>{state.loads++;},setNotice:notice=>state.notices.push(notice),
  ApiRequestError,parseApiResponse,
 });
 return {state,action};
}

test('expired invoice session asks for login once without reloading billing or resending email',async t=>{
 const {state,action}=fixture(t,'sendInvoiceEmail',[response(401,{error:'Authentication required'})]);
 await action({id:'INV-TEST'});
 assert.equal(state.requests.length,1);assert.equal(state.loads,0);assert.equal(state.logins,1);
 assert.match(state.notices.at(-1),/Sesi berakhir/);
});

test('session lost between issuing and emailing preserves issued invoice and stops requests',async t=>{
 const {state,action}=fixture(t,'issueAndSendInvoice',[response(200,{ok:true}),response(401,{error:'Authentication required'})]);
 await action({id:'INV-TEST'});
 assert.equal(state.requests.length,2);assert.equal(state.loads,0);assert.equal(state.logins,1);
 assert.equal(JSON.parse(state.requests[0].init.body).action,'ISSUE_INVOICE');
 assert.match(state.notices.at(-1),/Sesi berakhir/);
});

test('provider email failure retains partial-success notice without logging user out',async t=>{
 const {state,action}=fixture(t,'issueAndSendInvoice',[response(200,{ok:true}),response(502,{error:'Provider unavailable'})]);
 await action({id:'INV-TEST'});
 assert.equal(state.requests.length,2);assert.equal(state.loads,1);assert.equal(state.logins,0);
 assert.match(state.notices.at(-1),/Invoice sudah diterbitkan, tetapi email belum terkirim: Provider unavailable/);
});

test('successful email refreshes billing and displays actual provider recipient',async t=>{
 const {state,action}=fixture(t,'sendInvoiceEmail',[response(200,{ok:true,recipient:'billing@example.test'})]);
 await action({id:'INV-TEST',invoice_number:'INV/TEST'});
 assert.equal(state.requests.length,1);assert.equal(state.loads,1);assert.equal(state.logins,0);
 assert.match(state.notices.at(-1),/terkirim ke billing@example.test/);
});

test('unauthorized billing pagination stops at the first page and clears authentication',async t=>{
 const {state,action}=fixture(t,'loadAllBillingPages',[response(401,{error:'Authentication required'})]);
 await assert.rejects(action(),/Sesi berakhir/);
 assert.equal(state.requests.length,1);assert.equal(state.logins,1);
});

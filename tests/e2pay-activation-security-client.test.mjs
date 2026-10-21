import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchWithSecurityStepUp} from '../src/lib/security-step-up.ts';
import {parseApiResponse,AUTHENTICATION_REQUIRED_EVENT} from '../src/lib/api-client.ts';

const json=(status,body)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
const challenge=()=>json(428,{error:'MFA diperlukan',code:'MFA_STEP_UP_REQUIRED'});
function browser(t,prompt){
 const oldWindow=globalThis.window,oldFetch=globalThis.fetch;
 const events=new EventTarget();events.prompt=prompt;globalThis.window=events;
 t.after(()=>{globalThis.fetch=oldFetch;if(oldWindow===undefined)delete globalThis.window;else globalThis.window=oldWindow;});
 return events;
}

test('Master activation verifies MFA and retries the same action once',async t=>{
 let prompts=0;browser(t,()=>{prompts++;return '123456';});const calls=[];
 const init={method:'POST',headers:{'Content-Type':'application/json'},body:'{"action":"BIND_MASTER_ACCOUNT"}'};
 globalThis.fetch=async(url,options)=>{calls.push({url,options});return calls.length===1?challenge():json(200,{ok:true});};
 assert.equal((await fetchWithSecurityStepUp('/api/e2pay-operations',init)).status,200);
 assert.equal(prompts,1);assert.equal(calls.length,3);
 assert.equal(calls[1].url,'/api/security-mfa');assert.deepEqual(JSON.parse(calls[1].options.body),{action:'STEP_UP',code:'123456'});
 assert.equal(calls[2].options,init);
});

for(const code of [null,'123','1234567','12x3456'])test(`Cancelled/invalid MFA ${code} does not replay activation`,async t=>{
 browser(t,()=>code);let calls=0;globalThis.fetch=async()=>{calls++;return challenge();};
 assert.equal((await fetchWithSecurityStepUp('/api/e2pay-operations',{method:'POST'})).status,428);assert.equal(calls,1);
});

test('Rejected MFA and repeated challenge cannot loop or replay an unverified activation',async t=>{
 browser(t,()=>'123456');let calls=0;
 globalThis.fetch=async()=>{calls++;return calls===1?challenge():json(401,{error:'Kode MFA tidak valid',code:'MFA_CODE_INVALID'});};
 await assert.rejects(fetchWithSecurityStepUp('/api/e2pay-operations',{method:'POST'}),/Kode MFA tidak valid/);assert.equal(calls,2);
 calls=0;globalThis.fetch=async()=>{calls++;return calls===2?json(200,{ok:true}):challenge();};
 assert.equal((await fetchWithSecurityStepUp('/api/e2pay-operations',{method:'POST'})).status,428);assert.equal(calls,3);
});

test('Only an expired application session requests login; provider/MFA errors preserve the session',async t=>{
 const win=browser(t,()=>assert.fail('No MFA prompt for authentication failure'));let logins=0;
 win.addEventListener(AUTHENTICATION_REQUIRED_EVENT,()=>logins++);
 await assert.rejects(parseApiResponse(json(401,{error:'Authentication required'})),/Sesi berakhir/);assert.equal(logins,1);
 for(const body of [{error:'Kode MFA tidak valid',code:'MFA_CODE_INVALID'},{error:'Provider unauthorized',code:'E2PAY_AUTH_FAILED'}])await assert.rejects(parseApiResponse(json(401,body)));
 assert.equal(logins,1);
 let calls=0;globalThis.fetch=async()=>{calls++;return json(401,{error:'Authentication required'});};
 assert.equal((await fetchWithSecurityStepUp('/api/e2pay-operations',{method:'POST'})).status,401);assert.equal(calls,1);
});

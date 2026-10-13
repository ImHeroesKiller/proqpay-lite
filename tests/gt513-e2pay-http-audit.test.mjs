import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gatewayRuntimeEnv} from '../functions/api/payment-gateway-settings-store.js';
import {e2payHostAuthorize} from '../functions/api/payment-gateway-e2pay.js';

test('E2Pay captures a redacted copyable request JSON in the existing audit table',async()=>{
 const calls=[];
 const db={prepare(sql){return {bind(...args){return {async run(){calls.push({sql,args});return {success:true};}};}};}};
 const env={E2PAY_CLIENT_ID:'private-client-id',E2PAY_CLIENT_SECRET:'top-secret',E2PAY_ENV:'UAT'};
 const runtime=await gatewayRuntimeEnv(db,env,'ORG-A');
 const fetchImpl=async()=>new Response(JSON.stringify({access_token:'private-access-token',token_type:'Bearer'}),{status:200,headers:{'Content-Type':'application/json'}});
 const result=await e2payHostAuthorize(runtime,fetchImpl);
 assert.equal(result.accessToken,'private-access-token');
 const audit=calls.find(x=>x.sql.includes('INSERT INTO audit_logs'));
 assert.ok(audit,'audit row recorded');
 const payload=JSON.parse(audit.args[4]);
 assert.equal(payload.provider,'E2PAY');
 assert.equal(payload.status,'SUCCESS');
 assert.equal(payload.requestJson.client_secret,'[REDACTED]');
 assert.equal(payload.requestJson.client_id,'[REDACTED]');
 assert.equal(payload.requestJson.grant_type,'client_credentials');
 assert.ok(!JSON.stringify(payload).includes('top-secret'));
 assert.ok(!JSON.stringify(payload).includes('private-client-id'));
 assert.ok(!JSON.stringify(payload).includes('private-access-token'));
});
test('E2Pay audit detail UI supports copy and categorizes integration events',()=>{
 const ui=readFileSync(new URL('../src/components/SystemLogs.tsx',import.meta.url),'utf8');
 const api=readFileSync(new URL('../functions/api/audit-logs.js',import.meta.url),'utf8');
 assert.match(ui,/navigator\.clipboard\.writeText/);
 assert.match(ui,/E2Pay HTTP Request JSON/);
 assert.match(api,/action LIKE 'E2PAY_HTTP_%'/);
});

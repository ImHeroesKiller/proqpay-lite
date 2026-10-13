import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const route=readFileSync(new URL('../functions/api/e2pay-subaccounts.js',import.meta.url),'utf8');
test('all retired submerchant actions return HTTP 410 after auth and throttling',()=>{
 const start=route.indexOf('export async function onRequest');
 const body=route.slice(start);
 const auth=body.indexOf('await authorize(');
 const throttle=body.indexOf('await enforceRateLimit(');
 const gone=body.indexOf("code:'E2PAY_SUBACCOUNT_RETIRED'");
 const legacy=body.indexOf("if(request.method==='GET')");
 assert.ok(auth>=0 && throttle>auth && gone>throttle && legacy>gone);
 assert.match(body.slice(throttle,legacy),/},410,request,env,METHODS/);
});

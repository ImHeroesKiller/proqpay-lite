import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
const read=async path=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('P2 UAT runner disables browser traces, screenshots and video when secrets are provided',async()=>{
 const config=await read('playwright.uat.config.mjs');
 const workflow=await read('.github/workflows/playwright-uat.yml');
 assert.match(config,/credentialMode=process\.env\.UAT_CREDENTIALS_ENABLED==='true'\|\|Boolean\(process\.env\.PROQPAY_UAT_PASSWORD\)/);
 for(const kind of ['trace','screenshot','video'])assert.match(config,new RegExp(`${kind}: credentialMode\\?'off'`));
 assert.match(workflow,/if: always\(\) && env\.UAT_CREDENTIALS_ENABLED != 'true'/);
 assert.match(workflow,/Sensitive Playwright artifacts: intentionally disabled/);
 assert.doesNotMatch(workflow,/echo\s+[\"']?\$PROQPAY_UAT_PASSWORD\b/);
});

test('P2 authenticated tests fail explicitly on missing second factor or failed login without retrying',async()=>{
 const code=await read('tests/e2e/p2-authenticated-workspace.spec.mjs');
 assert.match(code,/P2_AUTH_LOGIN_TIMEOUT/);
 assert.match(code,/P2_BLOCKED_STRONG_AUTH/);
 assert.match(code,/P2_BLOCKED_AUTH/);
 assert.match(code,/PROQPAY_UAT_PASSWORD/);
 assert.match(code,/P2_AUTH_HANDSHAKE status=/);
 assert.match(code,/const callback=page\.waitForResponse/);
 assert.doesNotMatch(code,/while\s*\(.*login|for\s*\([^\n]*attempt/);
 assert.doesNotMatch(code,/ENROLL_ACTIVATE|PASSKEY_RECOVERY|resetPasskey|mfaSecret/);
});

test('P2 browser flows are read-only, and verify payment, DR, funding, reconciliation and EWA',async()=>{
 const code=await read('tests/e2e/p2-authenticated-workspace.spec.mjs');
 for(const pane of ['paymentPanel=PI','paymentPanel=DISBURSEMENT','paymentPanel=FUNDING','view=billing','view=ewa'])assert.ok(code.includes(pane),pane);
 assert.match(code,/reconciliation/i);
 assert.match(code,/width:1440/);
 assert.match(code,/width:390/);
 assert.doesNotMatch(code,/action:'EXECUTE'|action:'RECONCILE'|action:'APPROVE_REQUEST'|action:'SUBMIT_REQUEST'/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const src=readFileSync(new URL('../src/components/OperatingWorkspace.tsx',import.meta.url),'utf8');
test('Payment Instructions renders compact separate tabs without the oversized decision summary',()=>{
 assert.match(src,/className="payment-decision-tabs" role="tablist"/);
 assert.match(src,/role="tabpanel" tabIndex=\{0\}/);
 for(const x of ['PI','DISBURSEMENT','FUNDING']) assert.match(src,new RegExp("selectPaymentPanel\\('"+x+"'\\)"));
 assert.doesNotMatch(src,/className="payment-decision-metrics payment-decision-inline"/);
});
test('tab navigation preserves shared filters, backend guards and deep links',()=>{
 assert.match(src,/patchRoute\(\{paymentPanel:next\}\)/);
 assert.match(src,/subscribeRoute\(onRoute\)/);
 assert.match(src,/canApprove=\{canApprovePayment\}/);
 assert.match(src,/<CanonicalDisbursementWorkspace actor=\{actor\}/);
 assert.match(src,/<E2PayFundingLimitControl role=\{role\}/);
});

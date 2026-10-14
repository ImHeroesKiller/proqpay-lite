import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const src=readFileSync(new URL('../src/components/OperatingWorkspace.tsx',import.meta.url),'utf8');
test('payment workspace has one heading and compact tabs',()=>{
 assert.match(src,/payments: \{ title:'Payment Instructions', eyebrow:'PAYMENT CONTROL'/);
 assert.doesNotMatch(src,/<h2>Payment Workbench<\/h2>/);
 assert.doesNotMatch(src,/DECISION-CENTRIC PAYMENT CONTROL/);
 assert.match(src,/className="payment-decision-tabs"/);
});

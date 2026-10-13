import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const ui=await readFile(new URL('../src/components/DirectoryManager.tsx',import.meta.url),'utf8');
const routing=await readFile(new URL('../functions/api/payment-provider-routing.js',import.meta.url),'utf8');
test('Master-only client/project payment UI does not expose legacy project override controls',()=>{
 assert.match(ui,/Master Account Routing/);
 assert.match(ui,/Tidak ada project override/);
 const detail=ui.slice(ui.indexOf('title="Master E2Pay"'));
 assert.doesNotMatch(detail.slice(0,1700),/Register Project Override|Kirim ulang OTP aktivasi/);
});
test('new routing selects only organization Master registry',()=>{
 assert.match(routing,/account_scope='MASTER'/);
 assert.doesNotMatch(routing,/account_scope='SUB_ACCOUNT'/);
});

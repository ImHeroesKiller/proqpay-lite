import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const routing=await readFile(new URL('../functions/api/payment-provider-routing.js',import.meta.url),'utf8');
const ui=await readFile(new URL('../src/components/DirectoryManager.tsx',import.meta.url),'utf8');
test('Master-only routing fails closed if registry missing or inactive',()=>{
 assert.match(routing,/account_scope='MASTER'/);
 assert.match(routing,/master\?\.status==='ACTIVE'/);
 assert.doesNotMatch(routing,/account_scope='SUB_ACCOUNT'/);
});
test('Client and Project detail UI present unified Master payment model',()=>{
 assert.match(ui,/Saldo E2Pay Master dikelola terpusat/);
 assert.match(ui,/Project menggunakan Master Account E2Pay/);
});

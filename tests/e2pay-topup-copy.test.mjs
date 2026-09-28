import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source=await readFile(new URL('../src/components/E2PayOperationsConsole.tsx',import.meta.url),'utf8');
const css=await readFile(new URL('../src/app/e2pay-wallet.css',import.meta.url),'utf8');

test('E2Pay Top Up copies a complete cross-platform plain-text payload',()=>{
  assert.match(source,/TOP UP WALLET E2PAY/);
  assert.match(source,/Environment:/);
  assert.match(source,/Bank Tujuan:/);
  assert.match(source,/Virtual Account \(VA\):/);
  assert.match(source,/Nama Akun:/);
  assert.match(source,/Provider: E2Pay/);
  assert.match(source,/Terakhir Dicek:/);
  assert.match(source,/lines\.join\('\\n'\)/);
  assert.match(source,/Salin Info Top Up/);
});

test('E2Pay Top Up keeps a raw VA copy action and UAT safety note',()=>{
  assert.match(source,/Salin VA/);
  assert.match(source,/Dummy disbursement Permata 701075327 bukan rekening top up/);
  assert.match(source,/copyText\('va',account\?\.funding\?\.vaNumber\)/);
});

test('E2Pay Top Up provides clipboard fallback and readable share preview',()=>{
  assert.match(source,/navigator\.clipboard\?\.writeText/);
  assert.match(source,/document\.execCommand\('copy'\)/);
  assert.match(source,/Info siap ditempel ke WhatsApp, email, Slack, Notes/);
  assert.match(css,/\.e2pay-topup-share pre/);
  assert.match(css,/white-space:pre-wrap/);
});

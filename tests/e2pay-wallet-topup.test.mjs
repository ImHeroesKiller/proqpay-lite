import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read=(path)=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('E2Pay overview exposes authenticated wallet funding metadata without credential leakage',async()=>{
  const source=await read('functions/api/e2pay-operations.js');
  assert.match(source,/E2PAY_FUNDING_BANK/);
  assert.match(source,/funding:\{/);
  assert.match(source,/vaNumber/);
  assert.match(source,/bankName/);
  assert.match(source,/ready:Boolean\(fundingBank && vaNumber\)/);
  assert.doesNotMatch(source,/funding:\{[^}]*clientSecret/i);
  assert.doesNotMatch(source,/funding:\{[^}]*password/i);
});

test('Gateway settings persist funding bank separately from the provider bank directory',async()=>{
  const api=await read('functions/api/payment-gateway-settings.js');
  const store=await read('functions/api/payment-gateway-settings-store.js');
  assert.match(api,/fundingBank:clean\(body\.fundingBank/);
  assert.match(store,/E2PAY_FUNDING_BANK/);
  assert.match(store,/fundingBank:Boolean\(credentials\.fundingBank\)/);
  assert.match(store,/fundingBank:credentials\.fundingBank/);
});

test('Integrations presents an ewallet-style Top Up Wallet flow with safe transfer guidance',async()=>{
  const consoleSource=await read('src/components/E2PayOperationsConsole.tsx');
  const settings=await read('src/components/PaymentGatewaySettings.tsx');
  const css=await read('src/app/e2pay-wallet.css');

  assert.match(consoleSource,/\+ Top Up Wallet/);
  assert.match(consoleSource,/Virtual Account \(VA\)/);
  assert.match(consoleSource,/Bank tujuan/);
  assert.match(consoleSource,/Salin Info Top Up/);
  assert.match(consoleSource,/Refresh saldo/);
  assert.match(consoleSource,/Jangan melakukan transfer sebelum Super Admin/);
  assert.match(settings,/Funding bank \(Top Up\)/);
  assert.match(settings,/informasi resmi (?:dari )?E2Pay/);
  assert.match(css,/\.e2pay-topup-card/);
  assert.match(css,/@media \(max-width:560px\)/);
});

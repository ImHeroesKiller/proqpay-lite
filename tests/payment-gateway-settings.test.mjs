import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { D1Mock } from './helpers/d1-mock.mjs';
import {
  activateGatewaySecureSettings,
  gatewayRuntimeEnv,
  publicGatewaySettings,
  readGatewaySecureSettings,
  writeGatewaySecureSettings,
} from '../functions/api/payment-gateway-settings-store.js';

const env = {
  PI_ENCRYPTION_KEY:'gateway-settings-test-key-at-least-32-characters',
  PAYMENT_GATEWAY_PROVIDER:'UNCONFIGURED',
};

test('gateway credentials are encrypted at rest and runtime can hydrate E2Pay without browser exposure', async () => {
  const DB = new D1Mock();
  const stored = await writeGatewaySecureSettings(DB, env, 'ORG-OTSINDO', 'admin@proqpay.test', {
    provider:'E2PAY',
    environment:'UAT',
    credentials:{
      clientId:'uat-client-id',
      clientSecret:'uat-client-secret',
      username:'08123456789',
      passwordMd5:'ABCDEF0123456789ABCDEF0123456789',
      accountSrc:'1234567890',
      sourceId:'PROQPAY-UAT',
    },
  });
  assert.equal(stored.provider, 'UNCONFIGURED');
  assert.equal(stored.draftProvider, 'E2PAY');

  const row = DB.sqlite.prepare('SELECT * FROM gateway_secure_settings WHERE org_id=?').get('ORG-OTSINDO');
  assert.ok(row.credentials_ciphertext);
  assert.ok(row.credentials_iv);
  assert.doesNotMatch(String(row.credentials_ciphertext), /uat-client-secret|08123456789|1234567890/);

  const read = await readGatewaySecureSettings(DB, env, 'ORG-OTSINDO');
  assert.equal(read.credentials.clientSecret, 'uat-client-secret');
  let runtime = await gatewayRuntimeEnv(DB, { ...env, DB }, 'ORG-OTSINDO');
  assert.equal(runtime.PAYMENT_GATEWAY_PROVIDER, 'UNCONFIGURED');

  await activateGatewaySecureSettings(DB, env, 'ORG-OTSINDO', 'admin@proqpay.test', {
    provider:'E2PAY',
    environment:'UAT',
    credentials:{},
  });
  runtime = await gatewayRuntimeEnv(DB, { ...env, DB }, 'ORG-OTSINDO');
  assert.equal(runtime.PAYMENT_GATEWAY_PROVIDER, 'E2PAY');
  assert.equal(runtime.E2PAY_ENV, 'UAT');
  assert.equal(runtime.E2PAY_CLIENT_SECRET, 'uat-client-secret');

  const browserSafe = publicGatewaySettings(read);
  assert.equal(browserSafe.stored.clientSecret, true);
  assert.equal(browserSafe.masked.clientSecret, '••••••••');
  assert.doesNotMatch(JSON.stringify(browserSafe), /uat-client-secret/);
  DB.sqlite.close();
});

test('UAT and Production credentials stay isolated across environment switches', async () => {
  const DB = new D1Mock();
  await writeGatewaySecureSettings(DB, env, 'ORG-OTSINDO', 'admin@proqpay.test', {
    provider:'E2PAY',
    environment:'UAT',
    credentials:{
      clientId:'uat-client',
      clientSecret:'uat-secret',
      username:'uat-user',
      passwordMd5:'ABCDEF0123456789ABCDEF0123456789',
      accountSrc:'uat-account',
      sourceId:'UAT-SOURCE',
    },
  });
  await writeGatewaySecureSettings(DB, env, 'ORG-OTSINDO', 'admin@proqpay.test', {
    provider:'E2PAY',
    environment:'PRODUCTION',
    credentials:{
      clientId:'prod-client',
      clientSecret:'prod-secret',
      username:'prod-user',
      passwordMd5:'0123456789ABCDEF0123456789ABCDEF',
      accountSrc:'prod-account',
      sourceId:'PROD-SOURCE',
    },
  });

  const uat = await gatewayRuntimeEnv(DB, { ...env, DB }, 'ORG-OTSINDO', 'UAT');
  const prod = await gatewayRuntimeEnv(DB, { ...env, DB }, 'ORG-OTSINDO', 'PRODUCTION');
  assert.equal(uat.E2PAY_CLIENT_SECRET, 'uat-secret');
  assert.equal(prod.E2PAY_CLIENT_SECRET, 'prod-secret');
  assert.notEqual(uat.E2PAY_CLIENT_ID, prod.E2PAY_CLIENT_ID);

  const stored = await readGatewaySecureSettings(DB, env, 'ORG-OTSINDO');
  const browserSafe = publicGatewaySettings(stored);
  assert.equal(browserSafe.profiles.UAT.stored.clientSecret, true);
  assert.equal(browserSafe.profiles.PRODUCTION.stored.clientSecret, true);
  assert.doesNotMatch(JSON.stringify(browserSafe), /uat-secret|prod-secret/);
  DB.sqlite.close();
});

test('saved UNCONFIGURED state overrides any environment-level provider fallback', async () => {
  const DB = new D1Mock();
  await writeGatewaySecureSettings(DB, env, 'ORG-OTSINDO', 'admin@proqpay.test', {
    provider:'UNCONFIGURED',
    environment:'UAT',
    credentials:{},
  });
  const runtime = await gatewayRuntimeEnv(DB, {
    ...env,
    DB,
    PAYMENT_GATEWAY_PROVIDER:'E2PAY',
    E2PAY_ENV:'PRODUCTION',
  }, 'ORG-OTSINDO');
  assert.equal(runtime.PAYMENT_GATEWAY_PROVIDER, 'UNCONFIGURED');
  assert.equal(runtime.E2PAY_ENV, 'UAT');
  DB.sqlite.close();
});

test('gateway credential endpoint and settings UI are Super Admin only', async () => {
  const endpoint = await readFile(new URL('../functions/api/payment-gateway-settings.js', import.meta.url), 'utf8');
  const settings = await readFile(new URL('../src/components/SettingsModal.tsx', import.meta.url), 'utf8');
  const sidebar = await readFile(new URL('../src/components/Sidebar.tsx', import.meta.url), 'utf8');
  assert.match(endpoint, /const ROLES = \['SUPER_ADMIN'\]/);
  assert.match(settings, /tab === "paymentGateway" && role === "SUPER_ADMIN"/);
  assert.match(settings, /Provider dan credential E2Pay/);
  assert.doesNotMatch(sidebar.match(/PAYROLL_PROCESSOR:[\s\S]*?PAYROLL_CONTROLLER:/)?.[0] || '', /"integrations"/);
});

test('migration stores ciphertext instead of plaintext credential columns', async () => {
  const migration = await readFile(new URL('../migrations/0026_gateway_secure_settings.sql', import.meta.url), 'utf8');
  assert.match(migration, /credentials_ciphertext TEXT/);
  assert.match(migration, /credentials_iv TEXT/);
  assert.doesNotMatch(migration, /client_secret TEXT|password_md5 TEXT|account_src TEXT/);
});


test('UAT bootstrap profile stores only the supplied merchant bootstrap credential set', async () => {
  const DB = new D1Mock();
  await writeGatewaySecureSettings(DB, env, 'ORG-OTSINDO', 'admin@proqpay.test', {
    provider:'E2PAY',
    environment:'UAT',
    credentials:{
      merchantName:'PT Mandiri Semesta Gemilang',
      clientId:'uat-client',
      clientSecret:'uat-secret',
      partnerId:'0041',
      sourceId:'MANDIRIS',
    },
  });
  const runtime = await gatewayRuntimeEnv(DB, { ...env, DB }, 'ORG-OTSINDO', 'UAT');
  assert.equal(runtime.E2PAY_MERCHANT_NAME, 'PT Mandiri Semesta Gemilang');
  assert.equal(runtime.E2PAY_CLIENT_ID, 'uat-client');
  assert.equal(runtime.E2PAY_CLIENT_SECRET, 'uat-secret');
  assert.equal(runtime.E2PAY_PARTNER_ID, '0041');
  assert.equal(runtime.E2PAY_SOURCE_ID, 'MANDIRIS');
  assert.equal(runtime.E2PAY_USERNAME, '');
  assert.equal(runtime.E2PAY_PASSWORD_MD5, '');
  assert.equal(runtime.E2PAY_ACCOUNT_SRC, '');

  const stored = await readGatewaySecureSettings(DB, env, 'ORG-OTSINDO');
  const browserSafe = publicGatewaySettings(stored);
  assert.equal(browserSafe.stored.merchantName, true);
  assert.equal(browserSafe.stored.partnerId, true);
  assert.equal(browserSafe.stored.sourceId, true);
  assert.equal(browserSafe.stored.username, false);
  assert.equal(browserSafe.masked.merchantName, 'PT Mandiri Semesta Gemilang');
  assert.doesNotMatch(JSON.stringify(browserSafe), /uat-secret/);
  DB.sqlite.close();
});

test('Payment Gateway settings keeps bootstrap fields and accepts merchant login identity without accountSrc input', async () => {
  const ui = await readFile(new URL('../src/components/PaymentGatewaySettings.tsx', import.meta.url), 'utf8');
  assert.match(ui, /key:'merchantName', label:'Name'/);
  assert.match(ui, /key:'clientId', label:'clientId'/);
  assert.match(ui, /key:'clientSecret', label:'clientSecret'/);
  assert.match(ui, /key:'partnerId', label:'partnerId'/);
  assert.match(ui, /key:'sourceId', label:'sourceId'/);
  assert.match(ui, /key:'username', label:'username'/);
  assert.match(ui, /key:'password', label:'password'/);
  assert.match(ui, /key:'merchantId', label:'merchantId'/);
  assert.doesNotMatch(ui, /key:'accountSrc'/);
  assert.match(ui, /PT Mandiri Semesta Gemilang/);
  assert.match(ui, /0041/);
  assert.match(ui, /MANDIRIS/);
  assert.doesNotMatch(ui, /6281510000006|00410187/);
});


test('merchant login metadata and discovered source account stay encrypted and browser-safe', async () => {
  const DB = new D1Mock();
  await writeGatewaySecureSettings(DB, env, 'ORG-OTSINDO', 'admin@proqpay.test', {
    provider:'E2PAY',
    environment:'UAT',
    credentials:{
      merchantName:'Merchant UAT',
      clientId:'uat-client',
      clientSecret:'uat-secret',
      partnerId:'PARTNER-UAT',
      sourceId:'SOURCE-UAT',
      username:'6280000000000',
      passwordMd5:'5F4DCC3B5AA765D61D8327DEB882CF99',
      merchantId:'MERCHANT-UAT-001',
      accountSrc:'701000001',
    },
  });
  const runtime=await gatewayRuntimeEnv(DB,{...env,DB},'ORG-OTSINDO','UAT');
  assert.equal(runtime.E2PAY_USERNAME,'6280000000000');
  assert.equal(runtime.E2PAY_MERCHANT_ID,'MERCHANT-UAT-001');
  assert.equal(runtime.E2PAY_ACCOUNT_SRC,'701000001');
  const stored=await readGatewaySecureSettings(DB,env,'ORG-OTSINDO');
  const safe=publicGatewaySettings(stored);
  assert.equal(safe.stored.username,true);
  assert.equal(safe.stored.merchantId,true);
  assert.equal(safe.stored.accountSrc,true);
  assert.doesNotMatch(JSON.stringify(safe),/6280000000000|5F4DCC3B5AA765D61D8327DEB882CF99|701000001/);
  DB.sqlite.close();
});


test('saving a Production draft never switches active UAT runtime until explicit activation', async () => {
  const DB = new D1Mock();
  await writeGatewaySecureSettings(DB, env, 'ORG-OTSINDO', 'admin@proqpay.test', {
    provider:'E2PAY',
    environment:'UAT',
    credentials:{ clientId:'uat-client', clientSecret:'uat-secret' },
  });
  await activateGatewaySecureSettings(DB, env, 'ORG-OTSINDO', 'admin@proqpay.test', {
    provider:'E2PAY',
    environment:'UAT',
    credentials:{},
  });
  await writeGatewaySecureSettings(DB, env, 'ORG-OTSINDO', 'admin@proqpay.test', {
    provider:'E2PAY',
    environment:'PRODUCTION',
    credentials:{ clientId:'prod-client', clientSecret:'prod-secret' },
  });

  const stored = await readGatewaySecureSettings(DB, env, 'ORG-OTSINDO');
  assert.equal(stored.environment, 'UAT');
  assert.equal(stored.draftEnvironment, 'PRODUCTION');
  const runtime = await gatewayRuntimeEnv(DB, { ...env, DB }, 'ORG-OTSINDO');
  assert.equal(runtime.E2PAY_ENV, 'UAT');
  assert.equal(runtime.E2PAY_CLIENT_SECRET, 'uat-secret');
  DB.sqlite.close();
});

test('settings endpoint keeps TEST non-persistent and requires explicit activation confirmation', async () => {
  const endpoint = await readFile(new URL('../functions/api/payment-gateway-settings.js', import.meta.url), 'utf8');
  const ui = await readFile(new URL('../src/components/PaymentGatewaySettings.tsx', import.meta.url), 'utf8');
  assert.match(endpoint, /action === 'TEST'/);
  assert.match(endpoint, /persisted:false/);
  assert.doesNotMatch(endpoint.match(/if \(action === 'TEST'\)[\s\S]*?if \(action === 'ACTIVATE'\)/)?.[0] || '', /writeGatewaySecureSettings|activateGatewaySecureSettings/);
  assert.match(endpoint, /ACTIVATE_PRODUCTION/);
  assert.match(endpoint, /E2PAY_EXECUTION_NOT_READY/);
  assert.match(ui, /Configure → Save Draft → Test → Activate/);
  assert.match(ui, /Runtime payment belum berubah/);
  assert.match(ui, /Test Connection tidak menyimpan source account/);
});

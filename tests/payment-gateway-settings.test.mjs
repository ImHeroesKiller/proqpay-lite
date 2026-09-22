import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { D1Mock } from './helpers/d1-mock.mjs';
import {
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
  assert.equal(stored.provider, 'E2PAY');

  const row = DB.sqlite.prepare('SELECT * FROM gateway_secure_settings WHERE org_id=?').get('ORG-OTSINDO');
  assert.ok(row.credentials_ciphertext);
  assert.ok(row.credentials_iv);
  assert.doesNotMatch(String(row.credentials_ciphertext), /uat-client-secret|08123456789|1234567890/);

  const read = await readGatewaySecureSettings(DB, env, 'ORG-OTSINDO');
  assert.equal(read.credentials.clientSecret, 'uat-client-secret');
  const runtime = await gatewayRuntimeEnv(DB, { ...env, DB }, 'ORG-OTSINDO');
  assert.equal(runtime.PAYMENT_GATEWAY_PROVIDER, 'E2PAY');
  assert.equal(runtime.E2PAY_ENV, 'UAT');
  assert.equal(runtime.E2PAY_CLIENT_SECRET, 'uat-client-secret');

  const browserSafe = publicGatewaySettings(read);
  assert.equal(browserSafe.stored.clientSecret, true);
  assert.equal(browserSafe.masked.clientSecret, '••••••••');
  assert.doesNotMatch(JSON.stringify(browserSafe), /uat-client-secret/);
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

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { passwordRecord } from '../functions/api/_account-auth.js';
import { onRequest as login } from '../functions/api/login.js';
import { onRequest as reset } from '../functions/api/reset.js';
import { D1Mock } from './helpers/d1-mock.mjs';

test('full database reset is restricted to Super Admin and exact confirmation', async () => {
  const api = await readFile(new URL('../functions/api/purge-dummy-payroll.js', import.meta.url), 'utf8');
  assert.match(api, /roles:\s*\['SUPER_ADMIN'\]/);
  assert.match(api, /HAPUS SEMUA DATA/);
  assert.match(api, /authorization\.actor\.id/);
  assert.match(api, /DELETE FROM app_users WHERE id<>\?/);
  assert.match(api, /FULL_DATABASE_RESET/);
  assert.match(api, /DROP TRIGGER IF EXISTS/);
  assert.match(api, /RESTORE_GUARDS/);
});

test('settings exposes one full reset control only for Super Admin', async () => {
  const settings = await readFile(new URL('../src/components/SettingsModal.tsx', import.meta.url), 'utf8');
  assert.match(settings, /tab === "data" && role === "SUPER_ADMIN"/);
  assert.match(settings, />Hapus semua data</);
  assert.doesNotMatch(settings, /Hapus payment legacy & payroll dummy/);
});

test('confirmed reset clears business rows and keeps the acting Super Admin', async () => {
  const DB = new D1Mock();
  const record = await passwordRecord('NativeCloudflare!2026');
  DB.sqlite.prepare(`INSERT INTO app_users(id,org_id,name,email,role,status,password_hash,password_salt,password_iterations,must_change_password,payment_approver,created_by)
    VALUES(?,?,?,?,?,'ACTIVE',?,?,?,0,1,'test')`).run('USR-ROOT','ORG-OTSINDO','Root','root@proqpay.test','SUPER_ADMIN',record.hash,record.salt,record.iterations);
  DB.sqlite.prepare(`INSERT INTO clients(id,org_id,code,name) VALUES('CLI-RESET','ORG-OTSINDO','RESET','Reset Client')`).run();
  const origin = 'https://proqpay.test';
  const headers = { Origin: origin, 'Sec-Fetch-Site': 'same-origin' };
  const env = { DB, AUTH_MODE: 'session', DEFAULT_ORG_ID: 'ORG-OTSINDO', FILES: { delete: async () => {} } };
  const signedIn = await login({ request: new Request(`${origin}/api/login`, { method:'POST', headers, body:JSON.stringify({ email:'root@proqpay.test', password:'NativeCloudflare!2026' }) }), env });
  const cookie = signedIn.headers.get('set-cookie').split(';')[0];
  const response = await reset({ request: new Request(`${origin}/api/reset`, { method:'POST', headers:{ ...headers, Cookie:cookie }, body:JSON.stringify({ confirmation:'HAPUS SEMUA DATA' }) }), env });
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(DB.sqlite.prepare('SELECT COUNT(*) AS count FROM clients').get().count, 0);
  assert.equal(DB.sqlite.prepare('SELECT COUNT(*) AS count FROM app_users').get().count, 1);
  assert.equal(DB.sqlite.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action='FULL_DATABASE_RESET'").get().count, 1);
});

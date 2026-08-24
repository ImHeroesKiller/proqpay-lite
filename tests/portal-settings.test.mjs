import assert from 'node:assert/strict';
import test from 'node:test';
import { passwordRecord } from '../functions/api/_account-auth.js';
import { sanitizeHttpUrl, sanitizeBg } from '../functions/api/_portal-settings.js';
import { onRequest as employeeInit } from '../functions/api/employee/init.js';
import { onRequest as employeeLogin } from '../functions/api/employee/login.js';
import { onRequest as issueCredentials } from '../functions/api/employee-credentials.js';
import { onRequest as opsLogin } from '../functions/api/login.js';
import { onRequest as portalSettings } from '../functions/api/portal-settings.js';
import { handlePreflight } from '../functions/api/_security.js';
import { D1Mock } from './helpers/d1-mock.mjs';

const origin = 'https://proqpay.test';
const essOrigin = 'https://proqpay-ess.arywibowo.workers.dev';
const METHODS_HINT = 'GET, POST, OPTIONS';
const envFor = (DB) => ({ DB, AUTH_MODE: 'session', DEFAULT_ORG_ID: 'ORG-OTSINDO' });
const request = (path, options = {}) => new Request(`${origin}${path}`, {
  ...options,
  headers: { Origin: origin, 'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'application/json', ...(options.headers || {}) },
});

test('unsafe banner URLs and CSS are stripped', () => {
  assert.equal(sanitizeHttpUrl('javascript:alert(1)'), '');
  assert.equal(sanitizeHttpUrl('data:text/html,hi'), '');
  assert.equal(sanitizeHttpUrl('https://ads.example/click'), 'https://ads.example/click');
  assert.equal(sanitizeBg('url(javascript:alert(1))'), 'linear-gradient(115deg, #0f1b3a 0%, #1b2a52 55%, #24355f 100%)');
  assert.equal(sanitizeBg('#0f1b3a'), '#0f1b3a');
});

async function seed(DB) {
  DB.sqlite.exec(`
    INSERT OR IGNORE INTO organizations(id,name,code) VALUES('ORG-OTSINDO','OTSINDO','OTSINDO');
    INSERT OR IGNORE INTO clients(id,org_id,code,name,status) VALUES('CLI-QJOB','ORG-OTSINDO','QJOB','PT QJOB','ACTIVE');
    INSERT OR IGNORE INTO projects(id,org_id,client_id,code,name,created_by)
      VALUES('PRJ-NOC','ORG-OTSINDO','CLI-QJOB','NOC-P1','NOC','seed');
  `);
  DB.sqlite.prepare(`INSERT INTO employees(id,org_id,client_id,project_id,employee_code,name,status_aktif)
    VALUES(?,?,?,?,?,?,?)`).run('209200339', 'ORG-OTSINDO', 'CLI-QJOB', 'PRJ-NOC', 'EMP-209200339', 'ABDUL AZIZ', 'AKTIF');
  DB.sqlite.prepare(`INSERT INTO employee_contracts(id,employee_id,join_date,is_current) VALUES(?,?,?,1)`)
    .run('CTR-209200339', '209200339', '2020-09-20');
  const record = await passwordRecord('NativeCloudflare!2026');
  DB.sqlite.prepare(`INSERT INTO app_users
    (id,org_id,name,email,role,status,password_hash,password_salt,password_iterations,must_change_password,payment_approver,created_by)
    VALUES(?,?,?,?,?,'ACTIVE',?,?,?,0,1,'seed')`).run(
    'USR-ADMIN', 'ORG-OTSINDO', 'Admin', 'admin@proqpay.test', 'SUPER_ADMIN',
    record.hash, record.salt, record.iterations,
  );
}

async function cookieFor(DB) {
  const ops = await opsLogin({
    request: request('/api/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'admin@proqpay.test', password: 'NativeCloudflare!2026' }),
    }),
    env: envFor(DB),
  });
  return ops.headers.get('set-cookie').split(';')[0];
}

test('ops can save EWA rules and banners; employee init uses them', async () => {
  const DB = new D1Mock();
  await seed(DB);
  const env = envFor(DB);
  const cookie = await cookieFor(DB);

  const essPreflight = handlePreflight(
    new Request(`${origin}/api/portal-settings`, {
      method: 'OPTIONS',
      headers: { Origin: essOrigin, 'Access-Control-Request-Method': 'POST' },
    }),
    { APP_ORIGINS: origin },
    METHODS_HINT,
  );
  assert.equal(essPreflight.status, 403);

  const unauth = await portalSettings({ request: request('/api/portal-settings'), env });
  assert.equal(unauth.status, 401);

  const missingClient = await portalSettings({
    request: request('/api/portal-settings?clientId=CLI-UNKNOWN', { headers: { Cookie: cookie } }),
    env,
  });
  assert.equal(missingClient.status, 404);

  const empty = await portalSettings({
    request: request('/api/portal-settings', { headers: { Cookie: cookie } }),
    env,
  });
  assert.equal(empty.status, 200, await empty.clone().text());
  const defaults = await empty.json();
  assert.equal(defaults.policy.maxPercent, 0.3);
  assert.equal(defaults.policy.feeRate, 0.03);
  assert.equal(defaults.copy.ewaTitle, 'Advance Salary');
  assert.equal(defaults.ads[0].tag, 'Advance Salary');

  const saved = await portalSettings({
    request: request('/api/portal-settings', {
      method: 'POST',
      headers: { Cookie: cookie },
      body: JSON.stringify({
        policy: {
          enabled: true,
          feeRate: 0.025,
          minFee: 40000,
          minFeeAmount: 1500000,
          maxPercent: 0.2,
          maxTenorMonths: 1,
          minDaysWorked: 7,
          minTenureMonths: 0,
          minTenureDays: 10,
        },
        copy: {
          companyTagline: 'Gaji Digital Otsindo',
          ewaTitle: 'Gaji di Muka',
          ewaCta: 'Ajukan sekarang',
          ewaLimitCaption: 'Maks {percent}% gaji periode ini',
        },
        features: { adsEnabled: true },
        adsPlatform: { provider: 'GENERIC', impressionUrl: 'https://tracker.example/pixel.gif' },
        ads: [{
          enabled: true,
          tag: 'Promo HR',
          title: 'Cairkan lebih cepat',
          desc: 'Khusus karyawan aktif.',
          cta: 'Buka form',
          action: 'EWA',
          bg: '#102040',
        }, {
          enabled: true,
          tag: 'Eksternal',
          title: 'Program kesehatan',
          desc: 'Partner',
          cta: 'Kunjungi',
          action: 'EXTERNAL',
          href: 'javascript:alert(1)',
        }],
      }),
    }),
    env,
  });
  assert.equal(saved.status, 200, await saved.clone().text());
  const stored = await saved.json();
  assert.equal(stored.policy.maxPercent, 0.2);
  assert.equal(stored.policy.minTenureDays, 10);
  assert.equal(stored.policy.minTenureMonths, 0);
  assert.equal(stored.copy.companyTagline, 'Gaji Digital Otsindo');
  assert.equal(stored.ads[1].href, '', 'javascript URLs must be dropped');
  assert.equal(stored.adsPlatform.provider, 'GENERIC');

  const issued = await issueCredentials({
    request: request('/api/employee-credentials', {
      method: 'POST',
      headers: { Cookie: cookie },
      body: JSON.stringify({ action: 'ISSUE', limit: 10 }),
    }),
    env,
  });
  const issuedPayload = await issued.json();
  const password = issuedPayload.issued[0].password;
  DB.sqlite.prepare('UPDATE employee_credentials SET must_change_password=0 WHERE employee_id=?').run('209200339');
  const login = await employeeLogin({
    request: request('/api/employee/login', {
      method: 'POST',
      body: JSON.stringify({ emp_id: '209200339', password }),
    }),
    env,
  });
  const session = await login.json();
  const init = await employeeInit({
    request: request('/api/employee/init', { headers: { Authorization: `Bearer ${session.token}` } }),
    env,
  });
  assert.equal(init.status, 200, await init.clone().text());
  const payload = await init.json();
  assert.equal(payload.ewa.rules.maxPercent, 0.2);
  assert.equal(payload.ewa.rules.minTenureDays, 10);
  assert.equal(payload.ewa.rules.minTenureMonths, 0);
  assert.equal(payload.ewa.rules.feeRate, 0.025);
  assert.equal(payload.config.company.tagline, 'Gaji Digital Otsindo');
  assert.equal(payload.config.copy.ewaTitle, 'Gaji di Muka');
  assert.equal(payload.config.ads[0].title, 'Cairkan lebih cepat');
  assert.equal(payload.config.ads[1].href, '');
  assert.equal(payload.config.adsPlatform.impressionUrl, 'https://tracker.example/pixel.gif');
  assert.equal(DB.sqlite.prepare('SELECT COUNT(*) n FROM payroll_submissions').get().n, 0);
});

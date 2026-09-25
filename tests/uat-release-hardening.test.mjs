import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { D1Mock } from './helpers/d1-mock.mjs';
import { onRequest as monitorMiddleware } from '../functions/api/_middleware.js';

test('UAT: identified external app data pull is recorded without storing payloads', async () => {
  const DB = new D1Mock();
  const pending = [];
  const request = new Request('https://proqpay.test/api/payroll-reports?period=2026-09', {
    method:'GET',
    headers:{
      'X-ProQPay-App-Id':'proqtrack-uat',
      'X-ProQPay-App-Name':'ProQTrack UAT',
      'User-Agent':'ProQTrack-UAT/1.0',
    },
  });
  const response = await monitorMiddleware({
    request,
    env:{ DB, DEFAULT_ORG_ID:'ORG-OTSINDO' },
    next:async () => new Response(JSON.stringify({ ok:true, sensitive:'not-persisted' }), {
      status:200,
      headers:{ 'Content-Type':'application/json' },
    }),
    waitUntil:(promise) => pending.push(promise),
  });
  assert.equal(response.status, 200);
  await Promise.all(pending);

  const app = DB.sqlite.prepare('SELECT * FROM api_connected_apps WHERE app_id=?').get('proqtrack-uat');
  assert.equal(app.app_name, 'ProQTrack UAT');
  assert.equal(app.request_count, 1);
  assert.equal(app.data_pull_count, 1);
  assert.equal(app.last_endpoint, '/api/payroll-reports');

  const event = DB.sqlite.prepare('SELECT * FROM api_endpoint_events WHERE app_id=?').get('proqtrack-uat');
  assert.equal(event.event_type, 'DATA_PULL');
  assert.equal(event.method, 'GET');
  assert.equal(event.status_code, 200);

  const columns = DB.sqlite.prepare('PRAGMA table_info(api_endpoint_events)').all().map((row) => row.name);
  for (const forbidden of ['request_body','response_body','authorization','cookie','token','secret']) {
    assert.equal(columns.includes(forbidden), false);
  }
  DB.sqlite.close();
});

test('UAT: failed external request is observed but never counted as a successful data pull', async () => {
  const DB = new D1Mock();
  const pending = [];
  const request = new Request('https://proqpay.test/api/payroll-reports', {
    method:'GET',
    headers:{
      'X-ProQPay-App-Id':'external-denied',
      'X-ProQPay-App-Name':'Denied Client',
    },
  });
  const response = await monitorMiddleware({
    request,
    env:{ DB, DEFAULT_ORG_ID:'ORG-OTSINDO' },
    next:async () => new Response(JSON.stringify({ error:'Authentication required' }), { status:401 }),
    waitUntil:(promise) => pending.push(promise),
  });
  assert.equal(response.status, 401);
  await Promise.all(pending);
  const app = DB.sqlite.prepare('SELECT * FROM api_connected_apps WHERE app_id=?').get('external-denied');
  assert.equal(app.request_count, 1);
  assert.equal(app.data_pull_count, 0);
  assert.equal(app.error_count, 1);
  DB.sqlite.close();
});

test('UAT: Super Admin integration workspace contains gateway and API monitor only', async () => {
  const page = await readFile(new URL('../src/app/page.tsx', import.meta.url), 'utf8');
  const router = await readFile(new URL('../src/components/AppWorkspaceRouter.tsx', import.meta.url), 'utf8');
  const authority = await readFile(new URL('../shared/authority-matrix.js', import.meta.url), 'utf8');
  const sidebar = await readFile(new URL('../src/components/Sidebar.tsx', import.meta.url), 'utf8');
  const workspace = await readFile(new URL('../src/components/IntegrationsWorkspace.tsx', import.meta.url), 'utf8');
  const legacy = await readFile(new URL('../src/components/OperatingWorkspace.tsx', import.meta.url), 'utf8');

  assert.match(page, /AppWorkspaceRouter/);
  assert.match(router, /view === 'integrations'.*IntegrationsWorkspace/s);
  assert.match(authority.match(/SUPER_ADMIN: Object\.freeze\(\[[\s\S]*?\]\)/)?.[0] || '', /'integrations'/);
  assert.doesNotMatch(authority.match(/PAYROLL_PROCESSOR: Object\.freeze\(\[[\s\S]*?\]\)/)?.[0] || '', /'integrations'/);
  assert.match(workspace, /PaymentGatewayIntegrationPanel/);
  assert.match(workspace, /ApiEndpointMonitor/);
  assert.doesNotMatch(legacy, /HRIS','ATTENDANCE','ACCOUNTING','BANK/);
});

test('UAT: E2Pay UI exposes controlled failed-item retry and blocks generic whole-batch retry', async () => {
  const ui = await readFile(new URL('../src/components/PaymentGatewayExecutionActions.tsx', import.meta.url), 'utf8');
  const api = await readFile(new URL('../functions/api/payment-gateway.js', import.meta.url), 'utf8');
  assert.match(ui, /retryFailedE2PayPayment/);
  assert.match(ui, /e2payRetryable/);
  assert.match(ui, /Retry \$\{e2payRetryable\} Gagal/);
  assert.match(ui, /!isE2Pay \|\| e2payFailed === 0/);
  assert.match(api, /RETRY_FAILED/);
  assert.match(api, /response_code,''\)\)='99'/);
});

test('UAT: E2Pay reconciliation never treats missing response code as success', async () => {
  const core = await readFile(new URL('../functions/api/payment-gateway-e2pay.js', import.meta.url), 'utf8');
  const service = await readFile(new URL('../functions/api/payment-gateway-e2pay-service.js', import.meta.url), 'utf8');
  assert.match(core, /if \(code === '00'\) return 'SUCCEEDED'/);
  assert.doesNotMatch(core, /emptyIsSuccess/);
  assert.doesNotMatch(service, /emptyIsSuccess/);
  assert.match(service, /E2PAY_HTTP_ERROR/);
  assert.match(service, /\[408,429\]/);
});

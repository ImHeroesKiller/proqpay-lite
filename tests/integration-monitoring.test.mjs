import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('Integrations UI no longer renders legacy HRIS attendance accounting bank cards', async () => {
  const page = await readFile(new URL('../src/app/page.tsx', import.meta.url), 'utf8');
  const workspace = await readFile(new URL('../src/components/IntegrationsWorkspace.tsx', import.meta.url), 'utf8');
  assert.match(page, /IntegrationsWorkspace/);
  assert.doesNotMatch(page, /OperatingWorkspace mode="integrations"/);
  assert.match(workspace, /PaymentGatewayIntegrationPanel/);
  assert.match(workspace, /ApiEndpointMonitor/);
  assert.match(workspace, /Payment Gateway dan aktivitas aplikasi eksternal/);
});

test('API monitoring middleware observes identified apps without becoming an auth mechanism', async () => {
  const middleware = await readFile(new URL('../functions/api/_middleware.js', import.meta.url), 'utf8');
  const security = await readFile(new URL('../functions/api/_security.js', import.meta.url), 'utf8');
  assert.match(middleware, /X-ProQPay-App-Id/);
  assert.match(middleware, /Cf-Access-Client-Id/);
  assert.match(middleware, /const response = await context\.next\(\)/);
  assert.match(middleware, /do not grant access|do not grant|normal authentication/i);
  assert.doesNotMatch(middleware, /Authorization:\s*Bearer|authenticateApiClient|bypass/i);
  assert.match(security, /X-ProQPay-App-Id/);
  assert.match(security, /X-ProQPay-App-Name/);
});

test('API monitoring persists only request metadata and exposes Super Admin summary', async () => {
  const migration = await readFile(new URL('../migrations/0027_api_endpoint_monitoring.sql', import.meta.url), 'utf8');
  const endpoint = await readFile(new URL('../functions/api/integration-monitor.js', import.meta.url), 'utf8');
  assert.match(migration, /CREATE TABLE api_connected_apps/);
  assert.match(migration, /CREATE TABLE api_endpoint_events/);
  assert.doesNotMatch(migration, /authorization|cookie|request_body|response_body|token|secret/i);
  assert.match(endpoint, /const ROLES = \['SUPER_ADMIN'\]/);
  assert.match(endpoint, /data_pulls_24h/);
  assert.match(endpoint, /errors_24h/);
  assert.match(endpoint, /baseEndpoint/);
});

test('Payment Gateway integration panel reflects encrypted Settings-based E2Pay configuration', async () => {
  const panel = await readFile(new URL('../src/components/PaymentGatewayIntegrationPanel.tsx', import.meta.url), 'utf8');
  assert.match(panel, /E2Pay B2B Disbursement/);
  assert.match(panel, /Settings → Payment Gateway/);
  assert.match(panel, /Credential UAT dan Production disimpan sebagai profile terpisah/);
  assert.doesNotMatch(panel, /E2PAY_CLIENT_ID \/ E2PAY_CLIENT_SECRET<\/code> — Cloudflare Secret/);
});

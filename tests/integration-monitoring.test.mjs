import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('Integrations UI no longer renders legacy HRIS attendance accounting bank cards', async () => {
  const page = await readFile(new URL('../src/app/page.tsx', import.meta.url), 'utf8');
  const router = await readFile(new URL('../src/components/AppWorkspaceRouter.tsx', import.meta.url), 'utf8');
  const workspace = await readFile(new URL('../src/components/IntegrationsWorkspace.tsx', import.meta.url), 'utf8');
  const operating = await readFile(new URL('../src/components/OperatingWorkspace.tsx', import.meta.url), 'utf8');
  assert.match(page, /AppWorkspaceRouter/);
  assert.match(router, /IntegrationsWorkspace/);
  assert.doesNotMatch(page, /OperatingWorkspace mode="integrations"/);
  assert.match(workspace, /PaymentGatewayIntegrationPanel/);
  assert.match(workspace, /ApiEndpointMonitor/);
  assert.match(workspace, /Payment Gateway dan aktivitas aplikasi eksternal/);
  assert.doesNotMatch(operating, /\['HRIS','ATTENDANCE','ACCOUNTING','BANK'\]/);
  assert.doesNotMatch(operating, /Pantau koneksi HRIS, attendance, accounting, dan bank/);
});

test('API monitoring middleware observes identified apps without becoming an auth mechanism', async () => {
  const middleware = await readFile(new URL('../functions/api/_middleware.js', import.meta.url), 'utf8');
  const security = await readFile(new URL('../functions/api/_security.js', import.meta.url), 'utf8');
  assert.match(middleware, /X-ProQPay-App-Id/);
  assert.match(middleware, /Cf-Access-Client-Id/);
  assert.match(middleware, /const response = await context\.next\(\)/);
  assert.match(middleware, /normal ProQPay authentication/i);
  assert.doesNotMatch(middleware, /Authorization:\s*Bearer|authenticateApiClient/i);
  assert.match(middleware, /bypass normal ProQPay authentication/i);
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
  const consoleSource = await readFile(new URL('../src/components/E2PayOperationsConsole.tsx', import.meta.url), 'utf8');
  assert.match(panel, /E2Pay Disbursement/);
  assert.match(panel, /Settings → Payment Gateway/);
  assert.match(panel, /integration-runtime-strip/);
  assert.match(consoleSource, /Available balance/);
  assert.match(consoleSource, /Advanced administration/);
  assert.doesNotMatch(panel, /E2PAY_CLIENT_ID \/ E2PAY_CLIENT_SECRET<\/code> — Cloudflare Secret/);
});


test('P1 trusted-app lifecycle is explicit and cannot bypass endpoint authentication', async () => {
  const monitor = await readFile(new URL('../functions/api/integration-monitor.js', import.meta.url), 'utf8');
  const middleware = await readFile(new URL('../functions/api/_middleware.js', import.meta.url), 'utf8');
  assert.match(monitor, /\['ACTIVATE','ACTIVE'\]/);
  assert.match(monitor, /\['DEACTIVATE','INACTIVE'\]/);
  assert.match(monitor, /\['REVOKE','REVOKED'\]/);
  assert.match(monitor, /APP_REVOKED_TERMINAL/);
  assert.match(middleware, /ACTIVE means operator-trusted/);
  assert.match(middleware, /bypass normal ProQPay authentication/i);
});

test('P1 integration observability uses actor organization, retention and correlation ids', async () => {
  const accountAuth = await readFile(new URL('../functions/api/_account-auth.js', import.meta.url), 'utf8');
  const monitor = await readFile(new URL('../functions/api/integration-monitor.js', import.meta.url), 'utf8');
  const middleware = await readFile(new URL('../functions/api/_middleware.js', import.meta.url), 'utf8');
  const audit = await readFile(new URL('../functions/api/audit-logs.js', import.meta.url), 'utf8');
  const migration = await readFile(new URL('../migrations/0038_integrations_p1_hardening.sql', import.meta.url), 'utf8');
  assert.match(accountAuth, /u\.org_id/);
  assert.match(accountAuth, /orgId: user\.org_id/);
  assert.match(monitor, /actor\?\.orgId \|\| env\.DEFAULT_ORG_ID/);
  assert.match(monitor, /API_MONITOR_RETENTION_DAYS/);
  assert.match(monitor, /DELETE FROM api_endpoint_events/);
  assert.match(middleware, /authenticateSession/);
  assert.match(middleware, /X-Request-Id/);
  assert.match(middleware, /correlation_id/);
  assert.match(audit, /ev\.correlation_id AS correlation_id/);
  assert.match(migration, /ALTER TABLE api_endpoint_events ADD COLUMN correlation_id/);
  assert.match(migration, /ALTER TABLE audit_logs ADD COLUMN correlation_id/);
});

test('P1 Integrations UI distinguishes observed apps from trusted apps', async () => {
  const panel = await readFile(new URL('../src/components/ApiEndpointMonitor.tsx', import.meta.url), 'utf8');
  assert.match(panel, /Trusted apps/);
  assert.match(panel, /Observed apps/);
  assert.match(panel, /Mark Active/);
  assert.match(panel, /Revoke/);
  assert.match(panel, /autentikasi endpoint tetap wajib/);
  assert.match(panel, /Retention:/);
});


test('P2 Integrations API supports server-side filters pagination and operational health', async () => {
  const endpoint = await readFile(new URL('../functions/api/integration-monitor.js', import.meta.url), 'utf8');
  assert.match(endpoint, /eventOffset/);
  assert.match(endpoint, /eventLimit/);
  assert.match(endpoint, /appOffset/);
  assert.match(endpoint, /appLimit/);
  assert.match(endpoint, /statusClass/);
  assert.match(endpoint, /eventType/);
  assert.match(endpoint, /correlation_id/);
  assert.match(endpoint, /state:'HEALTHY'/);
  assert.match(endpoint, /state:'DEGRADED'/);
  assert.match(endpoint, /state:'DOWN'/);
  assert.match(endpoint, /avg_duration_ms/);
  assert.match(endpoint, /failingEndpoints/);
  assert.match(endpoint, /slowEndpoints/);
  assert.match(endpoint, /lower\(app_name\) LIKE \?/);
  assert.match(endpoint, /lower\(COALESCE\(last_endpoint,''\)\) LIKE \?/);
});

test('P2 Integrations UI exposes actionable health filtering recovery and mobile event cards', async () => {
  const panel = await readFile(new URL('../src/components/ApiEndpointMonitor.tsx', import.meta.url), 'utf8');
  const filter = await readFile(new URL('../src/components/integrations/IntegrationFilterBar.tsx', import.meta.url), 'utf8');
  const activity = await readFile(new URL('../src/components/integrations/IntegrationActivity.tsx', import.meta.url), 'utf8');
  const styles = await readFile(new URL('../src/app/globals.css', import.meta.url), 'utf8');
  assert.match(panel, /System health/);
  assert.match(panel, /Error rate 24h/);
  assert.match(panel, /Recovery guidance/);
  assert.match(panel, /Retry sekarang/);
  assert.match(filter, /Reset filter/);
  assert.match(activity, /Server-side filter & pagination/);
  assert.match(activity, /Correlation:/);
  assert.match(panel, /Auto-refresh 30 detik saat tab aktif/);
  assert.match(styles, /\.integration-events-mobile/);
  assert.match(styles, /@media \(max-width:760px\)/);
  assert.match(styles, /\.integration-filter-panel/);
});

test('Payment Gateway integration keeps primary operations visible and hides advanced detail by default', async () => {
  const panel = await readFile(new URL('../src/components/PaymentGatewayIntegrationPanel.tsx', import.meta.url), 'utf8');
  const consoleSource = await readFile(new URL('../src/components/E2PayOperationsConsole.tsx', import.meta.url), 'utf8');
  assert.match(panel, /Refresh status/);
  assert.match(panel, /Action required/);
  assert.match(panel, /Test Connection/);
  assert.match(panel, /Activate/);
  assert.match(consoleSource, /Transaction history/);
  assert.match(consoleSource, /Bank directory/);
  assert.match(consoleSource, /API endpoint coverage/);
  assert.match(consoleSource, /Advanced administration/);
  assert.match(consoleSource, /Disbursement tetap dijalankan melalui approved Payment Instruction/);
  assert.doesNotMatch(panel, /Operational recovery path/);
  assert.doesNotMatch(panel, /Runtime diagnostics/);
});

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('P3 uses one canonical integration health model across API and gateway UI', async () => {
  const health = await readFile(new URL('../src/lib/integration-health.ts', import.meta.url), 'utf8');
  const api = await readFile(new URL('../src/lib/integration-monitor-api.ts', import.meta.url), 'utf8');
  const monitor = await readFile(new URL('../src/components/ApiEndpointMonitor.tsx', import.meta.url), 'utf8');
  const gateway = await readFile(new URL('../src/components/PaymentGatewayIntegrationPanel.tsx', import.meta.url), 'utf8');
  assert.match(health, /IntegrationHealthState/);
  assert.match(health, /gatewayRuntimeHealth/);
  assert.match(health, /apiRecoveryGuidance/);
  assert.match(api, /IntegrationHealthState/);
  assert.match(monitor, /integrationHealthLabel/);
  assert.match(gateway, /gatewayRuntimeHealth/);
  assert.doesNotMatch(gateway, /function gatewayHealth/);
});

test('P3 decomposes monitor fetching filtering activity and primitives', async () => {
  const monitor = await readFile(new URL('../src/components/ApiEndpointMonitor.tsx', import.meta.url), 'utf8');
  const hook = await readFile(new URL('../src/hooks/useIntegrationMonitor.ts', import.meta.url), 'utf8');
  const filter = await readFile(new URL('../src/components/integrations/IntegrationFilterBar.tsx', import.meta.url), 'utf8');
  const activity = await readFile(new URL('../src/components/integrations/IntegrationActivity.tsx', import.meta.url), 'utf8');
  const primitives = await readFile(new URL('../src/components/integrations/IntegrationPrimitives.tsx', import.meta.url), 'utf8');
  assert.match(monitor, /useIntegrationMonitor/);
  assert.match(monitor, /IntegrationFilterBar/);
  assert.match(monitor, /IntegrationActivity/);
  assert.match(hook, /AbortController/);
  assert.match(hook, /visibilitychange/);
  assert.match(filter, /fieldset/);
  assert.match(activity, /caption className="sr-only"/);
  assert.match(primitives, /IntegrationPagination/);
});

test('P3 accessibility preserves labels live status captions and keyboard focus', async () => {
  const filter = await readFile(new URL('../src/components/integrations/IntegrationFilterBar.tsx', import.meta.url), 'utf8');
  const activity = await readFile(new URL('../src/components/integrations/IntegrationActivity.tsx', import.meta.url), 'utf8');
  const monitor = await readFile(new URL('../src/components/ApiEndpointMonitor.tsx', import.meta.url), 'utf8');
  const gateway = await readFile(new URL('../src/components/PaymentGatewayIntegrationPanel.tsx', import.meta.url), 'utf8');
  const styles = await readFile(new URL('../src/app/globals.css', import.meta.url), 'utf8');
  assert.match(filter, /htmlFor="integration-search"/);
  assert.match(filter, /legend className="sr-only"/);
  assert.match(activity, /aria-label=.*correlation ID/);
  assert.match(monitor, /aria-live="polite"/);
  assert.match(gateway, /aria-busy=/);
  assert.match(styles, /\.sr-only/);
  assert.match(styles, /\.integration-copy-id:focus-visible/);
});

test('P3 performance indexes operational integration filters', async () => {
  const migration = await readFile(new URL('../migrations/0039_integrations_p3_indexes.sql', import.meta.url), 'utf8');
  assert.match(migration, /idx_api_endpoint_events_type_created/);
  assert.match(migration, /idx_api_endpoint_events_status_created/);
  assert.match(migration, /idx_api_connected_apps_status_seen/);
});

test('final integrated regression keeps audit correlation and gateway safety contracts intact', async () => {
  const audit = await readFile(new URL('../functions/api/audit-logs.js', import.meta.url), 'utf8');
  const gatewaySettings = await readFile(new URL('../functions/api/payment-gateway-settings.js', import.meta.url), 'utf8');
  const monitorApi = await readFile(new URL('../functions/api/integration-monitor.js', import.meta.url), 'utf8');
  const middleware = await readFile(new URL('../functions/api/_middleware.js', import.meta.url), 'utf8');
  assert.match(audit, /correlation_id/);
  assert.match(gatewaySettings, /ACTIVATE_PRODUCTION/);
  assert.match(gatewaySettings, /persisted:false/);
  assert.match(monitorApi, /const ROLES = \['SUPER_ADMIN'\]/);
  assert.match(middleware, /bypass normal ProQPay authentication/i);
});

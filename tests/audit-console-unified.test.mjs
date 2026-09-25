import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const read=(path)=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('Audit Console is the only top-level log console',async()=>{
  const sidebar=await read('src/components/Sidebar.tsx');
  const page=await read('src/app/page.tsx');
  const workspace=await read('src/components/IntegrationsWorkspace.tsx');
  assert.match(sidebar,/title="Audit Console"/);
  assert.doesNotMatch(sidebar,/Portal Activity|portalAudit/);
  assert.doesNotMatch(page,/PortalAudit|portalAudit/);
  assert.doesNotMatch(workspace,/ApiEndpointMonitor/);
});

test('Audit Console API unifies business, employee portal and integration event stores',async()=>{
  const api=await read('functions/api/audit-console.js');
  assert.match(api,/FROM audit_logs/);
  assert.match(api,/FROM portal_login_attempts/);
  assert.match(api,/FROM api_endpoint_events/);
  assert.match(api,/EMPLOYEE_SERVICES/);
  assert.match(api,/INTEGRATIONS/);
  assert.match(api,/PAYMENTS/);
  assert.match(api,/BILLING_AR/);
  assert.match(api,/SECURITY/);
});

test('Audit Console surfaces canonical status, local diagnostics and payment gateway readiness',async()=>{
  const ui=await read('src/components/SystemLogs.tsx');
  assert.match(ui,/\/api\/audit-console/);
  assert.match(ui,/\/api\/health/);
  assert.match(ui,/\/api\/payment-gateway/);
  assert.match(ui,/loadSystemLogs/);
  assert.match(ui,/Unified event stream/);
  assert.match(ui,/Payment Gateway/);
  assert.match(ui,/System status/);
});

test('legacy standalone portal audit surface is removed',async()=>{
  const tree=await Promise.all([
    read('src/components/Sidebar.tsx'),
    read('src/app/page.tsx'),
  ]);
  assert.ok(tree.every((value)=>!value.includes('Portal Activity')));
});

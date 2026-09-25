import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const read=(path)=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('Audit Logs is the only audit page in the application shell',async()=>{
  const sidebar=await read('src/components/Sidebar.tsx');
  const page=await read('src/app/page.tsx');
  assert.match(sidebar,/title="Audit Logs"/);
  assert.doesNotMatch(sidebar,/Portal Activity/);
  assert.doesNotMatch(sidebar,/portalAudit/);
  assert.doesNotMatch(page,/components\/PortalAudit/);
  assert.doesNotMatch(page,/view === 'portalAudit'/);
  assert.match(page,/portalAudit.*return 'logs'/s);
});

test('Unified Audit Logs console covers canonical D1 and runtime local sources',async()=>{
  const ui=await read('src/components/SystemLogs.tsx');
  const api=await read('functions/api/audit-logs.js');
  assert.match(ui,/Audit Logs Control Center/);
  assert.match(ui,/Semua canonical D1/);
  assert.match(ui,/Runtime Local/);
  assert.match(api,/FROM audit_logs/);
  assert.match(api,/FROM portal_login_attempts/);
  assert.match(api,/authority: 'D1'/);
});

test('Unified audit queries are indexed by organization and time',async()=>{
  const migration=await read('migrations/0037_unified_audit_console_indexes.sql');
  assert.match(migration,/idx_audit_logs_org_timestamp/);
  assert.match(migration,/audit_logs\(org_id, timestamp DESC\)/);
});

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('portal media upload is role restricted, bounded, and stored in R2', async () => {
  const api = await readFile(new URL('../functions/api/portal-media.js', import.meta.url), 'utf8');
  assert.match(api, /roles: \['SUPER_ADMIN','PAYROLL_PROCESSOR'\]/);
  assert.match(api, /5 \* 1024 \* 1024/);
  assert.match(api, /portal-media\/\$\{orgId\}/);
  assert.match(api, /bucket\.put/);
  assert.doesNotMatch(api, /image\/svg\+xml/);
});

test('portal audit is consolidated and sidebar typography is uniform', async () => {
  const sidebar = await readFile(new URL('../src/components/Sidebar.tsx', import.meta.url), 'utf8');
  const css = await readFile(new URL('../src/app/globals.css', import.meta.url), 'utf8');
  const logs = await readFile(new URL('../src/components/SystemLogs.tsx', import.meta.url), 'utf8');
  assert.match(sidebar, /title="Audit & Portal Logs"/);
  assert.doesNotMatch(sidebar, /title="Portal Audit"/);
  assert.match(css, /\.sidebar-nav-button\{font-family:inherit!important;font-size:12px!important/);
  assert.match(logs, /<PortalAudit embedded/);
});

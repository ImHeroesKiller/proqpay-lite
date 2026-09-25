import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read=(path)=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('cross-app P2: global canonical auto-refresh is visibility-aware and catches up after returning visible', async()=>{
  const page=await read('src/app/page.tsx');
  const hook=await read('src/hooks/useVisibilityAwareCanonicalRefresh.ts');
  assert.match(page,/useVisibilityAwareCanonicalRefresh/);
  assert.match(hook,/document\.visibilityState !== 'visible'/);
  assert.match(hook,/document\.addEventListener\('visibilitychange', onVisibilityChange\)/);
  assert.match(hook,/Date\.now\(\) - lastRunAt >= intervalMs/);
  assert.match(hook,/document\.removeEventListener\('visibilitychange', onVisibilityChange\)/);
});

test('cross-app P2: Integrations correlation opens unified Audit Logs with automatic query filter', async()=>{
  const page=await read('src/app/page.tsx');
  const workspace=await read('src/components/IntegrationsWorkspace.tsx');
  const monitor=await read('src/components/ApiEndpointMonitor.tsx');
  const activity=await read('src/components/integrations/IntegrationActivity.tsx');
  const logs=await read('src/components/SystemLogs.tsx');
  const api=await read('functions/api/audit-logs.js');

  assert.match(page,/function openAuditCorrelation/);
  assert.match(page,/url\.searchParams\.set\('auditCorrelation', correlationId\)/);
  const router=await read('src/components/AppWorkspaceRouter.tsx');
  assert.match(page,/AppWorkspaceRouter[\s\S]*onOpenAuditCorrelation=\{openAuditCorrelation\}/);
  assert.match(router,/IntegrationsWorkspace[\s\S]*onOpenAuditCorrelation=\{props\.onOpenAuditCorrelation\}/);
  assert.match(workspace,/onOpenAuditCorrelation/);
  assert.match(monitor,/onTrace=\{onOpenAuditCorrelation\}/);
  assert.match(activity,/Open Audit Logs/);
  assert.match(logs,/get\("auditCorrelation"\)/);
  assert.match(logs,/Correlation trace aktif/);
  assert.match(logs,/url\.searchParams\.delete\("auditCorrelation"\)/);
  assert.match(api,/lower\(COALESCE\(correlation_id,''\)\) LIKE \?/);
});

test('cross-app P2: major workspaces are isolated by retryable module error boundary', async()=>{
  const page=await read('src/app/page.tsx');
  const router=await read('src/components/AppWorkspaceRouter.tsx');
  const boundary=await read('src/components/ModuleErrorBoundary.tsx');
  const css=await read('src/app/globals.css');

  assert.match(page,/AppWorkspaceRouter/);
  assert.match(router,/ModuleErrorBoundary/);
  assert.match(router,/resetKey=\{\`\$\{view\}:\$\{retryKey\}\`\}/);
  assert.match(router,/setRetryKey\(\(value\)=>value\+1\)/);
  assert.match(boundary,/getDerivedStateFromError/);
  assert.match(boundary,/componentDidCatch/);
  assert.match(boundary,/Retry module/);
  assert.match(boundary,/sesi aplikasi tetap dipertahankan/);
  assert.match(css,/\.module-error-boundary/);
});

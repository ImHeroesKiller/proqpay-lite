import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const read=(path)=>fs.readFile(new URL('../'+path,import.meta.url),'utf8');

test('P1 unified component system is shared by priority workspaces',async()=>{
  const [ui,billing,portal,audit,ewa,state,dialog,lifecycle]=await Promise.all([
    read('src/components/ui/UnifiedSystem.tsx'),
    read('src/components/BillingWorkspace.tsx'),
    read('src/components/PortalSettings.tsx'),
    read('src/components/SystemLogs.tsx'),
    read('src/components/EwaInbox.tsx'),
    read('src/components/employee-services/OperationalState.tsx'),
    read('src/components/employee-services/DisbursementDialog.tsx'),
    read('src/components/employee-services/EwaLifecycle.tsx'),
  ]);
  for(const token of ['WorkspaceHeader','MetricCard','SectionCard','FilterBar','DataTable','StatusBadge','FormField','ModalShell','EmptyState','LoadingState']){
    assert.match(ui,new RegExp('function '+token));
  }
  assert.match(billing,/UiSectionCard/);
  assert.match(billing,/UiDataTable/);
  assert.match(billing,/UiModalShell/);
  assert.match(portal,/UiWorkspaceHeader/);
  assert.match(portal,/UiTabs/);
  assert.match(audit,/UiWorkspaceHeader/);
  assert.match(audit,/UiFilterBar/);
  assert.match(ewa,/UiWorkspaceHeader/);
  assert.match(ewa,/UiMetricGrid/);
  assert.match(state,/UiEmptyState/);
  assert.match(dialog,/UiModalShell/);
  assert.match(lifecycle,/UiStatusBadge/);
});

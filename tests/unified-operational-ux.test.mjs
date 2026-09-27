import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read=(path)=>readFile(new URL(`../${path}`,import.meta.url),'utf8');

test('P2 unified operational primitives exist',async()=>{
  const ui=await read('src/components/ui/UnifiedSystem.tsx');
  assert.match(ui,/export function ActionBar/);
  assert.match(ui,/export function Pagination/);
  assert.match(ui,/export function DataTableState/);
  assert.match(ui,/event\.key === "Escape"/);
  assert.match(ui,/document\.body\.style\.overflow = "hidden"/);
});

test('priority operational workspaces adopt shared UX primitives',async()=>{
  const [audit,ewa,employees,portal,reports]=await Promise.all([
    read('src/components/SystemLogs.tsx'),
    read('src/components/EwaInbox.tsx'),
    read('src/components/EmployeeDirectory.tsx'),
    read('src/components/PortalSettings.tsx'),
    read('src/components/ReportsWorkspace.tsx'),
  ]);
  assert.match(audit,/Pagination as UiPagination/);
  assert.match(audit,/DataTableState as UiDataTableState/);
  assert.match(ewa,/Pagination as UiPagination/);
  assert.match(employees,/Pagination as UiPagination/);
  assert.match(employees,/EmptyState as UiEmptyState/);
  assert.match(portal,/ActionBar as UiActionBar/);
  assert.match(reports,/FilterBar as UiFilterBar/);
  assert.match(reports,/DataTableState as UiDataTableState/);
});

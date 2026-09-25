import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const read=(path)=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('Employee Service admin surfaces and APIs share Super Admin authority',async()=>{
  const sidebar=await read('src/components/Sidebar.tsx');
  const authority=await read('shared/authority-matrix.js');
  const ewa=await read('functions/api/ewa.js');
  const settings=await read('functions/api/portal-settings.js');
  const audit=await read('functions/api/portal-audit.js');
  assert.match(sidebar,/canManageEmployeeServices/);
  assert.match(authority,/SUPER_ADMIN:[\s\S]*?'employee-services:manage'/);
  assert.match(ewa,/const OPS = new Set\(\['SUPER_ADMIN'\]\)/);
  assert.match(settings,/const READERS = new Set\(\['SUPER_ADMIN'\]\)/);
  assert.match(settings,/const WRITERS = new Set\(\['SUPER_ADMIN'\]\)/);
  assert.match(audit,/const OPS = new Set\(\['SUPER_ADMIN'\]\)/);
});

test('Employee Service login rate limiting uses employee CORS responder',async()=>{
  const auth=await read('functions/api/_employee-auth.js');
  const login=await read('functions/api/employee/login.js');
  assert.match(auth,/export async function enforceEmployeeRateLimit/);
  assert.match(auth,/return employeeJson\(\{ error: 'Too many requests' \}, 429/);
  assert.match(login,/enforceEmployeeRateLimit/);
  assert.doesNotMatch(login,/enforceRateLimit/);
});

test('Employee Service payroll joins use one canonical payment instruction and reconciliation',async()=>{
  const init=await read('functions/api/_employee-init.js');
  const slips=await read('functions/api/employee/payslips.js');
  assert.match(init,/pi2\.status<>'REJECTED'/);
  assert.match(init,/ORDER BY pi2\.updated_at DESC,pi2\.created_at DESC,pi2\.id DESC LIMIT 1/);
  assert.match(init,/ORDER BY r2\.created_at DESC,r2\.id DESC LIMIT 1/);
  assert.match(slips,/pi2\.status='COMPLETED'/);
  assert.match(slips,/r2\.status='MATCHED'/);
});

test('Employee Service EWA home snapshot is current-period scoped',async()=>{
  const init=await read('functions/api/_employee-init.js');
  const ewa=await read('functions/api/employee/ewa.js');
  assert.match(init,/currentLine = runLines\.find/);
  assert.match(init,/currentSubmission = submissions\.find/);
  assert.match(ewa,/AND s\.period=\?/);
  assert.match(ewa,/payroll_source_period/);
});

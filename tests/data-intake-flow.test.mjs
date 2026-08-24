import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const api = readFileSync('functions/api/payroll-intake.js','utf8');
const migration = readFileSync('migrations/0017_employee_intake_history.sql','utf8');
const ui = readFileSync('src/app/data-intake/page.tsx','utf8');
const sidebar = readFileSync('src/components/Sidebar.tsx','utf8');

test('monthly intake is one upload followed by backend confirmation, not a second upload',()=>{
  assert.match(api,/PAYROLL_INTAKE_ALREADY_EXISTS/);
  assert.match(api,/READY_TO_CONFIRM/);
  assert.match(api,/confirmIntake/);
  assert.match(ui,/Upload & Analisis/);
  assert.match(ui,/Konfirmasi Intake & Buat Pay Run/);
});

test('latest confirmed employee data updates current master while preserving history',()=>{
  assert.match(migration,/CREATE TABLE IF NOT EXISTS employee_master_history/);
  assert.match(api,/UPDATE employees SET client_id=\?,project_id=\?,employee_code=\?,name=/);
  assert.match(api,/INSERT INTO employee_master_history/);
  assert.match(api,/action IN \('CREATED','UPDATED','MISSING_RESOLUTION'\)/);
});

test('missing employees require an explicit period resolution and no-pay does not force resignation',()=>{
  assert.match(api,/MISSING_EMPLOYEE_RESOLUTION_REQUIRED/);
  assert.match(api,/NO_PAY_THIS_PERIOD/);
  assert.match(api,/RESIGNED/);
  assert.match(ui,/Tidak menerima gaji periode ini/);
  assert.match(ui,/Resign \/ terminated/);
});

test('confirmed intake creates immutable-period payroll snapshot separately from current master',()=>{
  assert.match(api,/INSERT INTO payroll_run_lines/);
  assert.match(api,/source_batch_id/);
  assert.match(api,/source_row_hash/);
  assert.match(api,/PAYROLL_INTAKE_CONFIRMED/);
});

test('Data Intake is visible from Payroll navigation for operational roles',()=>{
  assert.match(sidebar,/href="\/data-intake"/);
  assert.match(sidebar,/SUPER_ADMIN','PAYROLL_PROCESSOR','CLIENT_USER/);
});

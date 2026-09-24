import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read=(path)=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('Pay Runs P1 restricts create and input finalization to Processor ownership',async()=>{
  const edge=await read('functions/api/operating-model.js');
  const d1=await read('functions/api/operating-model-d1.js');
  assert.match(edge,/PAY_RUN_CREATE_PERMISSION_REQUIRED/);
  assert.match(edge,/PAY_RUN_FINALIZE_PERMISSION_REQUIRED/);
  assert.match(d1,/Hanya Payroll Processor yang dapat membuat Pay Run/);
  assert.match(d1,/actor\.permissions\?\.includes\('submission:write'\)/);
  assert.doesNotMatch(d1,/CREATE_PAY_RUN'[\s\S]{0,250}!PROCESSOR_ROLES\.has\(actor\.role\) && !CLIENT_ROLES/);
});

test('Pay Runs P1 removes legacy UPLOAD_FINAL path from Pay Runs UI and contract',async()=>{
  const validation=await read('functions/api/operating-model-validation.js');
  const ui=await read('src/components/OperatingWorkspace.tsx');
  const edge=await read('functions/api/operating-model.js');
  assert.match(validation,/SOURCE_MODES = new Set\(\['MASTER_CURRENT','COPY_PREVIOUS'\]\)/);
  assert.match(edge,/PAY_RUN_UPLOAD_FINAL_MOVED_TO_DATA_INTAKE/);
  assert.doesNotMatch(ui,/<option value="UPLOAD_FINAL">/);
  assert.doesNotMatch(ui,/function PayRunUpload/);
  assert.match(ui,/Payroll final dari klien diproses melalui Data Intake/);
});

test('Pay Runs P1 locks payment period date and arrears after review starts',async()=>{
  const api=await read('functions/api/operating-model-d1.js');
  const validation=await read('functions/api/operating-model-validation.js');
  const ui=await read('src/components/OperatingWorkspace.tsx');
  assert.match(api,/PAYMENT_TERMS_LOCKED_AFTER_REVIEW/);
  assert.match(api,/UPDATE payroll_submissions SET payment_period=\?,payment_date=\?,arrears_periods=\?/);
  assert.match(api,/PAY_RUN_PAYMENT_TERMS_CHANGED/);
  assert.match(validation,/paymentDate harus berada pada paymentPeriod yang dipilih/);
  assert.match(ui,/Payment terms terkunci/);
  assert.match(ui,/paymentDate, arrearsPeriods:arrears/);
});

test('Pay Runs P1 reconciles COPY_PREVIOUS employee population',async()=>{
  const api=await read('functions/api/operating-model-d1.js');
  assert.match(api,/COPY_PREVIOUS_NEW_EMPLOYEE/);
  assert.match(api,/PAY_RUN_POPULATION_RECONCILED/);
  assert.match(api,/SYSTEM_EMPLOYEE_NOT_ELIGIBLE/);
  assert.match(api,/SYSTEM_EMPLOYEE_MISSING/);
  assert.match(api,/invalid_population/);
  assert.match(api,/missingEligible/);
});

test('Pay Runs P1 validates Adjustment parent integrity',async()=>{
  const api=await read('functions/api/operating-model-d1.js');
  assert.match(api,/ADJUSTMENT_PARENT_STATES/);
  assert.match(api,/parentSubmissionId hanya boleh digunakan untuk Adjustment/);
  assert.match(api,/parent\.run_type !== 'REGULAR'/);
  assert.match(api,/ADJUSTMENT_PARENT_NOT_FINAL/);
  assert.match(api,/parent\.period > body\.period/);
});

test('Pay Runs P1 records before-after line changes and preserves components',async()=>{
  const api=await read('functions/api/operating-model-d1.js');
  const validation=await read('functions/api/operating-model-validation.js');
  const ui=await read('src/components/OperatingWorkspace.tsx');
  assert.match(api,/PAY_RUN_LINE_CHANGED/);
  assert.match(api,/before:\{grossAmount:/);
  assert.match(api,/after:\{grossAmount:/);
  assert.match(api,/body\.components === undefined \? before\.components/);
  assert.match(validation,/changeReason wajib 10-500 karakter/);
  assert.match(ui,/Alasan perubahan nominal \(minimal 10 karakter\)/);
  assert.match(ui,/changeReason/);
});

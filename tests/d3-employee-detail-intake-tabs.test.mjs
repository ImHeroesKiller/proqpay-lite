import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const model=readFileSync(new URL('../src/lib/employee-ui.ts',import.meta.url),'utf8');
const drawer=readFileSync(new URL('../src/components/EmployeeDetailDrawer.tsx',import.meta.url),'utf8');
test('employee detail contains only intake-driven tabs',()=>{
 for(const text of ['Identitas & Penempatan','Rekening Pembayaran','Payroll per Periode'])assert.ok(drawer.includes(text));
 for(const text of ["title:'Kontrak'","title:'Kontak'","title:'Administrasi'"])assert.ok(!drawer.includes(text));
 assert.match(drawer,/role="tablist"/);
});
test('payroll shows no cross-period fallback and bank-only edit payload',()=>{
 assert.match(model,/employeeText\(employee\.payrollSourcePeriod\)!==period/);
 assert.match(model,/NO_PERIOD_DATA/);
 assert.match(drawer,/employeeIntakePayroll\(employee,selectedPeriod\)/);
 assert.match(drawer,/bankName:form.bankName,accountNo:form.accountNo/);
 assert.doesNotMatch(drawer,/id:employee.id,\.\.\.form/);
});

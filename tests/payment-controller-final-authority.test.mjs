import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { roleCanAction } from '../shared/authority-matrix.js';
import { derivePayrollNextAction } from '../src/lib/payroll-next-action-core.js';

const read=(path)=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('Payroll Controller is the only role allowed to execute payments',()=>{
  assert.equal(roleCanAction('PAYROLL_CONTROLLER','payment.execute'),true);
  assert.equal(roleCanAction('PAYROLL_PROCESSOR','payment.execute'),false);
  assert.equal(roleCanAction('SUPER_ADMIN','payment.execute'),false);
  assert.equal(roleCanAction('CLIENT_USER','payment.execute'),false);

  assert.equal(roleCanAction('PAYROLL_CONTROLLER','payment.approve'),true);
  assert.equal(roleCanAction('SUPER_ADMIN','payment.approve'),false);
});

test('workflow ownership moves approved payment and reconciliation to Payroll Controller',()=>{
  const processorApproved=derivePayrollNextAction({
    role:'PAYROLL_PROCESSOR',
    state:'APPROVED_FOR_PAYMENT',
    paymentInstructionStatus:'APPROVED_FOR_PAYMENT',
    permissions:['payment:prepare'],
  });
  assert.equal(processorApproved.code,'WAIT_PAYMENT_EXECUTION');
  assert.equal(processorApproved.actionable,false);
  assert.equal(processorApproved.owner,'PAYROLL_CONTROLLER');

  const controllerApproved=derivePayrollNextAction({
    role:'PAYROLL_CONTROLLER',
    state:'APPROVED_FOR_PAYMENT',
    paymentInstructionStatus:'APPROVED_FOR_PAYMENT',
    permissions:['payment:approve','reconciliation:write'],
  });
  assert.equal(controllerApproved.code,'PROCESS_PAYMENT');
  assert.equal(controllerApproved.actionable,true);
  assert.equal(controllerApproved.owner,'PAYROLL_CONTROLLER');

  const processorReconcile=derivePayrollNextAction({
    role:'PAYROLL_PROCESSOR',
    state:'PROOF_UPLOADED',
    paymentInstructionStatus:'PROOF_UPLOADED',
    permissions:['payment:prepare'],
  });
  assert.equal(processorReconcile.code,'WAIT_PAYMENT_RECONCILIATION');
  assert.equal(processorReconcile.actionable,false);
  assert.equal(processorReconcile.owner,'PAYROLL_CONTROLLER');

  const controllerReconcile=derivePayrollNextAction({
    role:'PAYROLL_CONTROLLER',
    state:'PROOF_UPLOADED',
    paymentInstructionStatus:'PROOF_UPLOADED',
    permissions:['payment:approve','reconciliation:write'],
  });
  assert.equal(controllerReconcile.code,'RECONCILE_PAYMENT');
  assert.equal(controllerReconcile.actionable,true);
});

test('all payment mutation endpoints enforce Payroll Controller authority',async()=>{
  const gateway=await read('functions/api/payment-gateway.js');
  const hosted=await read('functions/api/payment-gateway-hosted.js');
  const proof=await read('functions/api/payment-proof.js');
  const exporter=await read('functions/api/payment-instruction-export.js');
  const edge=await read('functions/api/operating-model.js');
  const d1=await read('functions/api/operating-model-d1.js');

  assert.match(gateway,/roles: request\.method === 'POST' \? \['PAYROLL_CONTROLLER'\] : ROLES/);
  assert.match(gateway,/PAYMENT_CONTROLLER_EXECUTION_REQUIRED/);
  assert.match(hosted,/roles:request\.method==='POST' \? \['PAYROLL_CONTROLLER'\] : ROLES/);
  assert.match(hosted,/PAYMENT_CONTROLLER_EXECUTION_REQUIRED/);
  assert.match(proof,/WRITE_ROLES = \['PAYROLL_CONTROLLER'\]/);
  assert.match(proof,/PAYMENT_CONTROLLER_EXECUTION_REQUIRED/);
  assert.match(exporter,/format !== 'PDF'/);
  assert.match(exporter,/authorization\.actor\.role !== 'PAYROLL_CONTROLLER'/);
  assert.match(exporter,/PAYMENT_CONTROLLER_EXECUTION_REQUIRED/);
  assert.match(edge,/actor\.role !== 'PAYROLL_CONTROLLER'/);
  assert.match(d1,/actor\.role !== 'PAYROLL_CONTROLLER'/);
});

test('integration administration remains Super Admin authority and is not coupled to payment execution',async()=>{
  const page=await read('src/app/page.tsx');
  const router=await read('src/components/AppWorkspaceRouter.tsx');
  assert.match(page,/const integrationsCanManage = roleCanAction\(actor\.role,'integrations\.manage'\)/);
  assert.match(router,/canManage=\{integrationsCanManage\}/);
});

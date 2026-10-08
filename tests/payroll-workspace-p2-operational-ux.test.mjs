import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read=(path)=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('P2 makes operational priority explicit in payroll stages',async()=>{
  const source=await read('src/components/OperatingWorkspace.tsx');
  assert.match(source,/operationalFocus/);
  assert.match(source,/NEXT ACTION/);
  assert.match(source,/OperationalFocus/);
  assert.match(source,/readyForExecution/);
  assert.match(source,/toReconcile/);
});

test('P2 orders payment queue by action priority and removes low-value created column',async()=>{
  const source=await read('src/components/OperatingWorkspace.tsx');
  assert.match(source,/PAYMENT_APPROVAL_PENDING:0/);
  assert.match(source,/PAYMENT_EXCEPTION:0/);
  assert.match(source,/headers=\{\['Instruction \/ Periode','Nilai','Status','Next action'\]\}/);
  assert.doesNotMatch(source,/headers=\{\['Instruction \/ Periode','Nilai','Status','Dibuat','Aksi'\]\}/);
});

test('P2 keeps controller in one PI surface after approval and gateway changes',async()=>{
  const source=await read('src/components/OperatingWorkspace.tsx');
  assert.match(source,/Approve & Continue/);
  assert.match(source,/await act\(\{action:'APPROVE_PAYMENT'.*'Payment Instruction disetujui berdasarkan content hash'\)/s);
  assert.match(source,/await openDetail\(current\.paymentInstruction\.id\)/);
  assert.match(source,/Status payment diperbarui'\);await openDetail\(detail\.paymentInstruction\.id\)/);
});

test('P2 uses progressive disclosure for technical PI and audit details',async()=>{
  const source=await read('src/components/OperatingWorkspace.tsx');
  assert.match(source,/pi-progressive-detail/);
  assert.match(source,/Rincian penerima & distribusi bank/);
  assert.match(source,/Governance & audit trail/);
});

test('P2 gives clean reconciliation a direct handoff to billing and close',async()=>{
  const [source,workspace]=await Promise.all([
    read('src/components/OperatingWorkspace.tsx'),
    read('src/components/UnifiedPayrollWorkspace.tsx'),
  ]);
  assert.match(source,/href:toReconcile\?undefined:'#billing-close'/);
  assert.match(source,/Lanjut Billing & AR/);
  assert.match(workspace,/id="billing-close"/);
});

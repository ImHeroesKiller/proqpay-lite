import test from 'node:test';
import assert from 'node:assert/strict';
import {compareWorkspaceValues,workspacePage} from '../src/lib/workspace-table.ts';
import {canRequestPeriodClose,workspaceStepCompletion,invoicePaymentState} from '../src/lib/workspace-progress.ts';

test('v2.1 financial sorting keeps numeric IDR order and Indonesian dates',()=>{
 assert.ok(compareWorkspaceValues('Rp 2.000','Rp 10.000',true)<0);
 assert.ok(compareWorkspaceValues('Rp 975.430.387','Rp 1.000.000.000',true)<0);
 assert.ok(compareWorkspaceValues('28/10/2026','01/11/2026')<0);
 assert.deepEqual(workspacePage(26,9,25),{page:2,pages:2});
 assert.deepEqual(workspacePage(0,9,25),{page:1,pages:1});
});
test('v2.1 close stays disabled with incomplete input, unknown evidence or critical exceptions',()=>{
 const row={input_status:'READY',state:'COMPLETED',payment_status:'COMPLETED',reconciliation_status:'MATCHED',invoice_status:'ISSUED',blocking_count:0,period_status:'OPEN'};
 assert.equal(canRequestPeriodClose(row),true);
 for(const patch of [{input_status:'PENDING'},{blocking_count:1},{blocking_count:undefined},{reconciliation_status:'PENDING'},{invoice_status:'APPROVED'},{period_status:'CLOSED'},{period_status:undefined}])assert.equal(canRequestPeriodClose({...row,...patch}),false);
});
test('v2.1 step completion never follows selected tab or successful payment without explicit close',()=>{
 assert.deepEqual(workspaceStepCompletion([]),{PAYROLL:false,PAYMENT:false,CLOSE:false});
 assert.deepEqual(workspaceStepCompletion([{state:'DRAFT',payment_status:'PENDING',period_status:'OPEN'}]),{PAYROLL:false,PAYMENT:false,CLOSE:false});
 assert.deepEqual(workspaceStepCompletion([{state:'COMPLETED',payment_status:'COMPLETED',period_status:'OPEN'}]),{PAYROLL:true,PAYMENT:true,CLOSE:false});
});
test('v2.1 invoice collection remains unknown without actual AR evidence',()=>{
 assert.equal(invoicePaymentState('ISSUED'),'UNKNOWN');
 assert.equal(invoicePaymentState('ISSUED',{balance:10000}),'OUTSTANDING');
 assert.equal(invoicePaymentState('PARTIALLY_PAID',{balance:10000}),'PARTIALLY_PAID');
 assert.equal(invoicePaymentState('PAID'),'PAID');
});

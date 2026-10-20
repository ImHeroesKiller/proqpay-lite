import {readGlobalCss} from './helpers/style-sources.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {
 paymentPanel,paymentDecisionSummary,defaultPaymentPanel,canonicalActionRank,canonicalNeedsAction,
} from '../src/lib/payment-decision-workbench.ts';

const read=(file)=>readFile(new URL('../'+file,import.meta.url),'utf8');

test('P1.B panel route accepts only the three allowed business decisions',()=>{
 for(const name of ['PI','DISBURSEMENT','FUNDING'])assert.equal(paymentPanel(name),name);
 for(const invalid of ['PAYMENT_EXECUTE','AUTOPAY','',null,'funding'])assert.equal(paymentPanel(invalid),null);
});

test('P1.B Controller gets PI approvals first and Processor gets PI submit/revision first',()=>{
 const rows=[{status:'PAYMENT_INSTRUCTION_READY'},{status:'PAYMENT_APPROVAL_PENDING'},{status:'PAYMENT_APPROVAL_PENDING'},{status:'APPROVED_FOR_PAYMENT'},{status:'REVISION_REQUIRED'}];
 const controller=paymentDecisionSummary(rows,'PAYROLL_CONTROLLER');
 const processor=paymentDecisionSummary(rows,'PAYROLL_PROCESSOR');
 assert.equal(controller.primaryCount,3);assert.equal(controller.piApproved,1);
 assert.equal(processor.primaryCount,2);assert.equal(processor.piReady,1);
 assert.equal(defaultPaymentPanel(rows,'PAYROLL_CONTROLLER'),'PI');
 assert.equal(defaultPaymentPanel([{status:'APPROVED_FOR_PAYMENT'}],'PAYROLL_CONTROLLER'),'PI','approved PI must remain accessible to final Controller even without pending approvals');
 assert.equal(defaultPaymentPanel([], 'PAYROLL_PROCESSOR'),'DISBURSEMENT');
 assert.equal(defaultPaymentPanel([], 'PAYROLL_CONTROLLER'),'DISBURSEMENT');
});

test('P1.B Canonical DR actionable statuses and sorting respect Maker/Checker authority',()=>{
 assert.equal(canonicalActionRank('PENDING_APPROVAL','PAYROLL_CONTROLLER'),0);
 assert.equal(canonicalActionRank('APPROVED','PAYROLL_CONTROLLER'),1);
 assert.equal(canonicalActionRank('READY','PAYROLL_PROCESSOR'),0);
 assert.ok(canonicalActionRank('RECONCILED','PAYROLL_CONTROLLER')>canonicalActionRank('APPROVED','PAYROLL_CONTROLLER'));
 assert.equal(canonicalNeedsAction('PENDING_APPROVAL','PAYROLL_CONTROLLER'),true);
 assert.equal(canonicalNeedsAction('APPROVED','PAYROLL_CONTROLLER'),true);
 assert.equal(canonicalNeedsAction('APPROVED','PAYROLL_PROCESSOR'),false);
 assert.equal(canonicalNeedsAction('READY','PAYROLL_PROCESSOR'),true);
 assert.equal(canonicalNeedsAction('READY','SUPER_ADMIN'),false);
 assert.equal(canonicalNeedsAction('RECONCILED','PAYROLL_CONTROLLER'),false);
});

test('P1.B payment workbench has exactly one visible PI, DR or Funding content surface per selection',async()=>{
 const source=await read('src/components/OperatingWorkspace.tsx');
 assert.match(source,/aria-label="Unified Payment Workbench"/);
 assert.match(source,/displayedPaymentPanel==='PI'\?<Payments phase="payment"/);
 assert.match(source,/displayedPaymentPanel==='DISBURSEMENT'\?<CanonicalDisbursementWorkspace/);
 assert.match(source,/displayedPaymentPanel==='FUNDING'&&\['SUPER_ADMIN','PAYROLL_PROCESSOR','PAYROLL_CONTROLLER'\]/);
 assert.match(source,/mode !== 'billing' && mode !== 'payments'/);
 assert.match(source,/mode!=='payments' \? <OperationalFocus/);
 assert.match(source,/const displayedPaymentPanel=activePaymentPanel\|\|defaultPaymentPanel/);
 assert.match(source,/patchRoute\(\{paymentPanel:next\}\)/);
 assert.match(source,/subscribeRoute\(onRoute\)/);
});

test('P1.B Canonical workspace exposes action-first queue, monitoring toggle and immutable review',async()=>{
 const source=await read('src/components/CanonicalDisbursementWorkspace.tsx');
 assert.match(source,/canonical-disbursement-compact/);
 assert.match(source,/canonicalNeedsAction\(row.status,actor\?\.role/);
 assert.match(source,/canonicalActionRank\(a.status,actor\?\.role/);
 assert.match(source,/queueFilter==='ACTION'\?actionable:visible/);
 assert.match(source,/Tindakan saya/);
 assert.match(source,/Semua status/);
 assert.match(source,/Immutable Disbursement Snapshot/);
 assert.match(source,/Ketik BAYAR/);
 assert.match(source,/checker&&selected.status==='PENDING_APPROVAL'/);
 assert.match(source,/executor&&row.status==='APPROVED'/);
 assert.match(source,/role==='PAYROLL_CONTROLLER'/);
});

test('P1.B shared client/project/query filters reach DR while funding panel preserves account selection',async()=>{
 const [workspace,funding]=await Promise.all([read('src/components/OperatingWorkspace.tsx'),read('src/components/E2PayFundingLimitControl.tsx')]);
 assert.match(workspace,/projectId=\{projectFilter\} query=\{query\} compact/);
 assert.match(workspace,/canonicalDecisionKnown\?` \(\$\{canonicalDecisionActions\}\)`/);
 assert.match(workspace,/setCanonicalDecisionKnown\(false\)/);
 assert.match(workspace,/response\.ok/);
 assert.match(funding,/setClientId\(e\.target\.value\)/);
 assert.match(funding,/Balance Master &amp; Limit Klien/);
});

test('P1.B post-recovery and Hosted Payment return to the correct payment workbench panel',async()=>{
 const [navigation,checkout,page]=await Promise.all([read('src/lib/workspace-navigation.ts'),read('src/components/PaymentGatewayExecutionActions.tsx'),read('src/app/page.tsx')]);
 assert.match(navigation,/paymentPanel:'FUNDING'/);
 assert.match(checkout,/view=payments[^`]*paymentPanel=PI/);
 assert.match(page,/fundingAccountId:null,recoveryComplete:null,paymentPanel:null/);
});

test('P1.B mobile payment navigation retains compact legible buttons, no fixed-width panel or fake provider readiness',async()=>{
 const [css,workspace]=await Promise.all([readGlobalCss(),read('src/components/UnifiedPayrollWorkspace.tsx')]);
 assert.match(css,/\.payment-decision-nav\{display:grid;grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
 assert.match(css,/@media\(max-width:760px\)/);
 assert.match(css,/\.canonical-queue-switch/);
 assert.match(css,/\.payment-decision-main\{display:grid;gap:12px;min-width:0\}/);
 assert.match(workspace,/final execution hanya Payroll Controller/);
});

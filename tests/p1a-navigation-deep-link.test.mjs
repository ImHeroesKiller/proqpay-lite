import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {
  PAYROLL_STAGE_URL,PAYROLL_STAGE_VIEW,validAppView,payrollStage,
  normalizeInternalRoute,recoveryReturnUrl,resolveRecoveryTarget,
} from '../src/lib/workspace-navigation.ts';

const src=async name=>readFile(new URL('../'+name,import.meta.url),'utf8');

test('P1.A canonical view contract accepts previous payment-instructions deep links without defaulting to dashboard',()=>{
 assert.equal(validAppView('payment-instructions'),'payments');
 assert.equal(validAppView('portalAudit'),'logs');
 assert.equal(validAppView('unknown'),null);
 assert.equal(validAppView('clients'),'clients');
 assert.equal(validAppView('payments'),'payments');
});

test('P1.A stage and view cannot diverge for internal Processor/Controller',()=>{
 for(const [stage,view,url] of [['PAYROLL','operations','payroll'],['PAYMENT','payments','payment'],['CLOSE','billing','close']]){
   assert.equal(PAYROLL_STAGE_VIEW[stage],view);
   assert.equal(PAYROLL_STAGE_URL[stage],url);
   assert.equal(payrollStage(url),stage);
   assert.deepEqual(normalizeInternalRoute('operations',url,true),{view,stage});
 }
 assert.deepEqual(normalizeInternalRoute('clients','payment',true),{view:'clients',stage:null});
 assert.deepEqual(normalizeInternalRoute('payments','payment',false),{view:'payments',stage:null});
 assert.deepEqual(normalizeInternalRoute('payments','broken',true),{view:'payments',stage:'PAYMENT'});
});

test('P1.A exact recovery URL preserves account and period and returns to active payment stage',()=>{
 const url=new URL(recoveryReturnUrl('REG-0190','2026-09'),'https://proqpay.test');
 assert.equal(url.searchParams.get('view'),'payments');
 assert.equal(url.searchParams.get('stage'),'payment');
 assert.equal(url.searchParams.get('paymentPanel'),'FUNDING');
 assert.equal(url.searchParams.get('fundingAccountId'),'REG-0190');
 assert.equal(url.searchParams.get('recoveryComplete'),'1');
 assert.equal(url.searchParams.get('period'),'2026-09');
 assert.equal(new URL(recoveryReturnUrl('REG-0190',null),'https://proqpay.test').searchParams.has('period'),false);
});

test('P1.A legacy Client recovery resolves only exact account and client; project overrides open correct Project',()=>{
 const clients=[{id:'C-1',name:'One'},{id:'C-2',name:'Two'}];
 const projects=[{id:'P-1',client_id:'C-1'},{id:'P-2',client_id:'C-2'}];
 const accounts=[{id:'REG-0190',clientId:'C-1',projectId:null},{id:'REG-P1',clientId:'C-1',projectId:'P-1'},{id:'REG-P2',clientId:'C-2',projectId:'P-2'}];
 let resolution=resolveRecoveryTarget('C-1','REG-0190',accounts,clients,projects);
 assert.equal(resolution.kind,'client');assert.equal(resolution.target.id,'C-1');
 resolution=resolveRecoveryTarget('C-1','REG-P1',accounts,clients,projects);
 assert.equal(resolution.kind,'project');assert.equal(resolution.target.id,'P-1');
 assert.equal(resolveRecoveryTarget('C-2','REG-P1',accounts,clients,projects).error,'ACCOUNT_NOT_FOUND');
 assert.equal(resolveRecoveryTarget('C-1','REG-P2',accounts,clients,projects).error,'ACCOUNT_NOT_FOUND');
 assert.equal(resolveRecoveryTarget('C-1','REG-P1',accounts,clients,[]).error,'PROJECT_NOT_FOUND');
 assert.equal(resolveRecoveryTarget('C-1','REG-0190',accounts,[],projects).error,'CLIENT_NOT_FOUND');
});

test('P1.A application parent owns stage navigation and browser Back/Forward restoration',async()=>{
 const [page,workspace,router]=await Promise.all([src('src/app/page.tsx'),src('src/components/UnifiedPayrollWorkspace.tsx'),src('src/components/AppWorkspaceRouter.tsx')]);
 assert.match(workspace,/onNavigate\(PAYROLL_STAGE_VIEW\[next\]\)/);
 assert.match(workspace,/window\.history\.replaceState\(window\.history\.state,'',url\)/);
 assert.doesNotMatch(workspace,/window\.history\.pushState/);
 assert.match(router,/onNavigate=\{props\.onNavigate\}/);
 assert.match(page,/url\.searchParams\.set\('stage',PAYROLL_STAGE_URL\[stageForView\(safeView\)\]\)/);
 assert.match(page,/window\.history\.pushState/);
 assert.match(page,/window\.addEventListener\('popstate', onPopState\)/);
 assert.match(page,/normalizeInternalRoute\(normalizedView,params\.get\('stage'\)/);
});

test('P1.A funding recovery link is role-safe and exact destination return is canonical',async()=>{
 const [funding,directory]=await Promise.all([src('src/components/E2PayFundingLimitControl.tsx'),src('src/components/DirectoryManager.tsx')]);
 assert.match(funding,/const canRecover=role==='SUPER_ADMIN'\|\|role==='PAYROLL_PROCESSOR'/);
 assert.match(funding,/canRecover\?<Link/);
 assert.match(funding,/recoveryAccountId=\$\{encodeURIComponent\(selected\.providerAccountRegistryId\)\}/);
 assert.match(funding,/recoveryReturnView=payments/);
 assert.match(directory,/resolveRecoveryTarget\(recoveryClientId,recoveryAccountId,e2payAccounts,clients,projects\)/);
 assert.match(directory,/recoveryReturnUrl\(account\.id,params\.get\('period'\)\)/);
 assert.doesNotMatch(directory,/window\.location\.assign\(`\/\?view=payment-instructions/);
});

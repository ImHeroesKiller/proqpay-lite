import {test,expect,chromium} from '@playwright/test';
import {permissionsForRole} from '../../shared/authority-matrix.js';
import {mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

// Local fixtures only. Never connect this test to a real payment environment.
const base=process.env.BASE_URL||'http://127.0.0.1:39822';
const before=process.env.WORKSPACE_V21_BEFORE==='1';
const capture=process.env.WORKSPACE_V21_CAPTURE||'artifacts/workspace-v21';
const pi={id:'PI-TEST',submission_id:'RUN-TEST',document_no:'PI-202610-001',client_id:'C-TEST',project_id:'P-TEST',client_name:'Klien Pengujian',project_name:'Project Pengujian',payroll_period:'2026-10',payment_period:'2026-10',status:'PAYMENT_APPROVAL_PENDING',expected_total:3000000,recipient_count:200,created_at:'2026-10-28T05:00:00Z'};
const submissions=[{id:'RUN-TEST',client_id:'C-TEST',client_name:'Klien Pengujian',project_id:'P-TEST',project_name:'Project Pengujian',period:'2026-10',payment_period:'2026-10',state:'PAYMENT_APPROVAL_PENDING',total_net:3000000,employee_count:200,blocking_count:0,source_mode:'MASTER_CURRENT',run_type:'REGULAR'},{id:'RUN-OLD',client_id:'C-TEST',client_name:'Klien Pengujian',project_id:'P-TEST',project_name:'Project Pengujian',period:'2026-09',state:'DRAFT',total_net:150000,employee_count:10,blocking_count:0,source_mode:'MASTER_CURRENT'}];
const closed={...submissions[0],id:'RUN-CLOSED',state:'COMPLETED',input_status:'READY',payment_status:'COMPLETED',reconciliation_status:'MATCHED',invoice_status:'ISSUED',period_status:'CLOSED',closed_by:'controller@example.test',closed_at:'2026-10-28'};
submissions.push({...closed,id:'RUN-READY',period_status:'OPEN'},closed);
const register={disbursementRequestId:'DR-REGISTER',clientId:'C-TEST',projectId:'P-TEST',clientReference:'DR-202610-REGISTER',sourceDocumentId:'PI-202610-001',provider:'E2PAY',amount:3000000,recipientCount:200,status:'SETTLED',executionStatus:'SUCCESS',reconciliationStatus:'MATCHED',settledAmount:3000000,lastReconciledAt:'2026-10-28T05:00:00Z'};
const dr={id:'DR-TEST',clientId:'C-TEST',projectId:'P-TEST',sourceDocumentType:'PAYMENT_INSTRUCTION',sourceDocumentId:'PI-TEST',purpose:'PAYROLL',destinationMode:'DIRECT_EMPLOYEE',clientReference:'DR-202610-001',status:'PENDING_APPROVAL',provider:'E2PAY',environment:'UAT',amount:3000000,recipientCount:200,items:[]};
for(const width of [1440,1280,1024,768,390,360])test(`workspace v21 layout and state at ${width}px`,async()=>{
 if(!['localhost','127.0.0.1'].includes(new URL(base).hostname))throw new Error('Local only');
 const browser=await chromium.launch({executablePath:process.env.E2PAY_CHROMIUM_EXECUTABLE,headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--no-zygote','--single-process']});
 try{
 const page=await browser.newPage({viewport:{width,height:1000},bypassCSP:true});const errors=[];const writes=[];
 await page.emulateMedia({reducedMotion:'reduce'});
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url());if(url.origin!==base)return route.abort();if(!url.pathname.startsWith('/api/'))return route.continue();
  if(req.method()!=='GET'){writes.push(url.pathname);return route.fulfill({status:403,json:{error:'No writes allowed in visual test'}});}
  let body={ok:true,periods:['2026-10','2026-09'],submissions,paymentInstructions:[pi],paymentProofs:[],reconciliations:[],exceptions:[],records:[],requests:[],funding:[],clients:[],projects:[],employees:[],servicePlans:[],arItems:[],invoices:[],billablePayments:[],portfolioSummary:{clients:1}};
  if(url.pathname==='/api/operating-model'){const resource=url.searchParams.get('resource');if(resource!=='submissions')body.submissions=[];if(resource!=='payment-instructions')body.paymentInstructions=[];if(resource==='pay-run-detail')body={ok:true,submission:submissions.find(row=>row.id===url.searchParams.get('submissionId'))};}
  if(url.pathname==='/api/me')body={authenticated:true,authMode:'session',user:{id:'TEST-CONTROLLER',orgId:'ORG-TEST',name:'Pengguna Pengujian',email:'controller@example.test',role:'PAYROLL_CONTROLLER',permissions:permissionsForRole('PAYROLL_CONTROLLER'),clientIds:[],projectIds:[]}};
  if(url.pathname==='/api/disbursement-requests')body=url.searchParams.has('id')?{ok:true,request:dr}:{ok:true,requests:[dr]};
  if(url.pathname==='/api/client-projects')body={ok:true,clients:[{id:'C-TEST',name:'Klien Pengujian'}],projects:[{id:'P-TEST',client_id:'C-TEST',name:'Project Pengujian'}]};
  if(url.pathname==='/api/e2pay-operations')body=url.searchParams.get('resource')==='master-activation'?{ok:true,environment:'UAT',registryId:'MASTER-TEST',connectionReady:true,balance:10000000,checks:{credentialConfigured:true,registryActive:true,identityMatched:true,merchantActive:true,balanceFresh:true},channels:[]}:{ok:true,account:{available:true,balance:10000000,environment:'UAT',merchantStatus:'ACTIVE'}};
  if(url.pathname==='/api/e2pay-disbursement-limits')body={ok:true,funding:[{providerAccountRegistryId:'MASTER-TEST',environment:'UAT',clientId:null,parent:{ready:true,state:'READY',balance:10000000},accountReadiness:{ready:true}}],requests:[{id:'LIMIT-TEST',clientId:'C-TEST',clientName:'Klien Pengujian',projectId:'P-TEST',projectName:'Project Pengujian',environment:'UAT',status:'ACTIVE',requestedAmount:5000000,approvedAmount:5000000,committedAmount:1000000,remainingAmount:4000000,requestedAt:'2026-10-27T05:00:00Z',approvedAt:'2026-10-28T05:00:00Z',requestedByEmail:'maker@example.test',approvedByEmail:'controller@example.test'}]};
  if(url.pathname==='/api/billing')body={ok:true,clients:[{id:'C-TEST',company:'Klien Pengujian'}],billablePayments:[],invoices:[{id:'INV-TEST',submission_id:'RUN-READY',client_id:'C-TEST',project_id:'P-TEST',company:'Klien Pengujian',project_name:'Project Pengujian',invoice_number:'INV/2026/10/001',period:'2026-10',total_amount:10000,status:'ISSUED',email_status:'NOT_SENT'}],arItems:[{id:'AR-TEST',invoice_id:'INV-TEST',submission_id:'RUN-READY',client_id:'C-TEST',project_id:'P-TEST',company:'Klien Pengujian',project_name:'Project Pengujian',invoice_number:'INV/2026/10/001',period:'2026-10',amount:10000,paid_amount:0,balance:10000,status:'CURRENT',aging_days:0}]};
  if(url.pathname==='/api/canonical-transaction-register')body=url.searchParams.has('id')?{ok:true,register,items:[],reconciliationAttempts:[]}:{ok:true,transactions:[register],pagination:{page:1,pageSize:40,total:1,totalPages:1,hasNext:false}};
  await route.fulfill({status:200,json:body});
 });
 async function shot(options){
  if(!before&&[1440,390].includes(width)){
   await page.addScriptTag({path:fileURLToPath(new URL('../../node_modules/axe-core/axe.min.js',import.meta.url))});
   const violations=await page.evaluate(async()=>{const report=await window.axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa']}});return report.violations.map(v=>({id:v.id,targets:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))}));});
   expect(violations).toEqual([]);
  }
  await page.screenshot(options);
 }
 await mkdir(capture,{recursive:true});
 await page.goto(base+'/?view=operations',{waitUntil:'networkidle'});
 await expect(page.getByRole('heading',{name:'Payroll Workspace',exact:true})).toBeVisible();
 await shot({path:`${capture}/payroll-${width}.png`,fullPage:true});
 if(!before){
  await page.locator('.payroll-shared-filter').locator('label').filter({hasText:'Periode'}).locator('select').selectOption('2026-10');
  await expect(page).toHaveURL(/workspacePeriod=2026-10/);
  await page.locator('.pay-run-group-tabs').getByRole('button',{name:/^Pay\s/}).click();
  await expect(page).toHaveURL(/payrollGroup=PAY/);
 }
 await page.locator('.payroll-stage-nav').getByRole('button',{name:/Approval & Payment/}).click();
 await page.getByRole('tab',{name:/Payment Instructions/}).click();
 await expect(page.getByText('PI-202610-001',{exact:true})).toBeVisible();
 await shot({path:`${capture}/pi-${width}.png`,fullPage:true});
 if(!before){
  await expect(page.locator('.payroll-shared-filter').locator('label').filter({hasText:'Periode'}).locator('select')).toHaveValue('2026-10');
  await page.locator('.pi-status-filter select').selectOption('PAYMENT_APPROVAL_PENDING');await expect(page).toHaveURL(/piStatus=PAYMENT_APPROVAL_PENDING/);
  const tab=page.getByRole('tab',{name:/Payment Instructions/});expect(await tab.evaluate(el=>getComputedStyle(el).backgroundImage)).toBe('none');expect(await tab.evaluate(el=>getComputedStyle(el).borderBottomWidth)).toBe('2px');await tab.focus();await page.keyboard.press('ArrowRight');
 }else await page.getByRole('tab',{name:/Disbursement/}).click();
 await expect(page.getByText('DR-202610-001',{exact:true})).toBeVisible();
 await shot({path:`${capture}/disbursement-${width}.png`,fullPage:true});
 if(!before){await page.locator('.canonical-status-filter select').selectOption('PENDING_APPROVAL');await expect(page).toHaveURL(/drStatus=PENDING_APPROVAL/);await page.getByRole('button',{name:'Lihat Detail',exact:true}).click();await expect(page.getByRole('dialog',{name:'Immutable Disbursement Snapshot'})).toBeVisible();await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);}
 await page.getByRole('tab',{name:'Funding & Limit',exact:true}).click();
 await expect(page.getByText('Balance Master & Limit Klien',{exact:true})).toBeVisible();
 if(!before)expect(await page.getByRole('region',{name:'Master Funding dan Limit',exact:true}).evaluate(el=>el.getBoundingClientRect().right<=innerWidth+1)).toBeTruthy();
 await shot({path:`${capture}/funding-${width}.png`,fullPage:true});
 if(!before){await page.getByRole('button',{name:'Lihat detail',exact:true}).click();await expect(page.getByRole('dialog',{name:'Detail alokasi limit'})).toBeVisible();await shot({path:`${capture}/drawer-${width}.png`});await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);await page.reload({waitUntil:'networkidle'});await expect(page.getByRole('tab',{name:'Funding & Limit'})).toHaveAttribute('aria-selected','true');await page.getByRole('tab',{name:/Disbursement/}).click();await expect(page.locator('.canonical-status-filter select')).toHaveValue('PENDING_APPROVAL');}
 await page.locator('.payroll-stage-nav').getByRole('button',{name:/Reconcile & Close/}).click();
 if(!before){
  await expect(page.getByRole('heading',{name:'Disbursement Register',exact:true})).toBeVisible();
  await shot({path:`${capture}/reconciliation-${width}.png`,fullPage:true});
  await page.getByRole('tab',{name:'Settlement & Close',exact:true}).click();
  await expect(page.getByText('Period Close Readiness',{exact:true})).toBeVisible();
  await expect(page.getByRole('heading',{name:'Disbursement Register',exact:true})).toHaveCount(0);
  await shot({path:`${capture}/settlement-${width}.png`,fullPage:true});
  await page.getByRole('button',{name:'Review & Close'}).first().click();
  await expect(page.getByRole('button',{name:'Close Period',exact:true})).toBeDisabled();
  await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'Review & Close'}).last().click();
  await expect(page.getByRole('button',{name:'Close Period',exact:true})).toBeEnabled();
  await page.keyboard.press('Escape');
  await page.getByRole('tab',{name:'Billing & AR',exact:true}).click();
  await expect(page.getByText('Period Close Readiness',{exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'INV/2026/10/001',exact:true})).toBeVisible();
  await shot({path:`${capture}/billing-${width}.png`,fullPage:true});
  await page.reload({waitUntil:'networkidle'});
  await expect(page.getByRole('tab',{name:'Billing & AR',exact:true})).toHaveAttribute('aria-selected','true');
  await expect(page.locator('.payroll-shared-filter select').first()).toHaveValue('2026-10');
  await page.getByRole('button',{name:'Reset filter',exact:true}).click();
  await expect(page.locator('.payroll-shared-filter select').first()).toHaveValue('ALL');
 }else await shot({path:`${capture}/close-${width}.png`,fullPage:true});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBeTruthy();expect(errors).toEqual([]);expect(writes).toEqual([]);
 }finally{await browser.close();}
});

test('v21 register API failure stays distinct from no data and preserves unavailable global selection',async()=>{
 if(!['localhost','127.0.0.1'].includes(new URL(base).hostname))throw new Error('Local only');
 const browser=await chromium.launch({executablePath:process.env.E2PAY_CHROMIUM_EXECUTABLE,headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--no-zygote','--single-process']});
 try{
 const page=await browser.newPage();let failed=true,writes=0;
 await page.route('**/*',route=>{
  const req=route.request(),url=new URL(req.url());if(url.origin!==base)return route.abort();if(!url.pathname.startsWith('/api/'))return route.continue();
  if(req.method()!=='GET'){writes++;return route.fulfill({status:405,json:{error:'Read only'}});}
  if(url.pathname==='/api/me')return route.fulfill({json:{authenticated:true,authMode:'session',user:{id:'V21',orgId:'TEST',name:'Test Controller',role:'PAYROLL_CONTROLLER',permissions:permissionsForRole('PAYROLL_CONTROLLER'),clientIds:[],projectIds:[]}}});
  if(url.pathname==='/api/canonical-transaction-register'&&failed)return route.fulfill({status:503,json:{error:'Synthetic register unavailable'}});
  return route.fulfill({json:{ok:true,transactions:[],submissions:[],clients:[],projects:[],periods:[],paymentInstructions:[],records:[],pagination:{page:1,pageSize:40,total:0,totalPages:1,hasNext:false}}});
 });
 await page.goto(base+'/?view=billing&stage=close&clientId=C-UNAVAILABLE&closePanel=RECONCILIATION',{waitUntil:'networkidle'});
 await expect(page.locator('.canonical-register-workspace').getByRole('alert')).toContainText('Synthetic register unavailable');
 await expect(page.getByText('Tidak ada transaksi pada filter ini',{exact:true})).toHaveCount(0);
 await expect(page.locator('.payroll-shared-filter').getByText('Klien terpilih (tidak tersedia)',{exact:true})).toHaveCount(1);
 failed=false;await page.getByRole('button',{name:'Coba lagi',exact:true}).click();
 await expect(page.getByText('Tidak ada transaksi pada filter ini',{exact:true})).toBeVisible();
 await expect(page.locator('.canonical-register-workspace').getByRole('alert')).toHaveCount(0);expect(writes).toBe(0);
 }finally{await browser.close();}
});

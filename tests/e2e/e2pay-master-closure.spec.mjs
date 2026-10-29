import {test,chromium,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {permissionsForRole} from '../../shared/authority-matrix.js';

// Run against the local static build. All APIs are intercepted; outside origins
// and any action other than the three synthetic setup actions are rejected.
for(const role of ['SUPER_ADMIN','PAYROLL_PROCESSOR','PAYROLL_CONTROLLER','CLIENT_USER']){
 test(`E2Pay Master setup and limit permissions: ${role}`,async()=>{
  const base=process.env.E2PAY_LOCAL_UAT_URL||process.env.BASE_URL||'http://127.0.0.1:4173';
  if(!['127.0.0.1','localhost'].includes(new URL(base).hostname))throw new Error('Local synthetic UAT only');
  const browser=await chromium.launch({headless:true,...(process.env.E2PAY_CHROMIUM_EXECUTABLE?{executablePath:process.env.E2PAY_CHROMIUM_EXECUTABLE,args:['--no-sandbox','--disable-gpu','--disable-software-rasterizer','--disable-dev-shm-usage','--no-zygote','--single-process']}:{})});
  try{
   const context=await browser.newContext({viewport:{width:1280,height:900}});
   const page=await context.newPage();
let dashboardMasterChecked=false;let bound=role!=='SUPER_ADMIN';let mfaVerified=false;let expired=false;const actions=[];const errors=[];let prompts=0;
 page.on('dialog',async dialog=>{if(dialog.type()==='confirm'){await dialog.accept();return;}assert.equal(dialog.type(),'prompt');prompts++;await dialog.accept(dialog.message().includes('Ketik BAYAR')?'BAYAR':'123456');});
 let approvalMode=false;let piStatus='PAYMENT_APPROVAL_PENDING';let drStatus='PENDING_APPROVAL';let piRejected=false;let balanceFails=true;let balanceReads=0;let balanceReady=false;let executionCalls=0;let reissueMode=false;let replacement=false;
 const pi=()=>({id:'PI-MOCK',client_id:'C-MOCK',project_id:'P-MOCK',document_no:'PI/MOCK',client_name:'Mock Client',payroll_period:'2026-10',payment_period:'2026-10',status:piStatus,expected_total:2000,recipient_count:26,content_hash:'MOCK-HASH',provider:'E2PAY',provider_environment:'UAT',provider_account_registry_id:'MASTER-MOCK',providerAccountScope:'MASTER',providerFunding:{ready:balanceReady,state:balanceReady?'AVAILABLE':'PARENT_STALE',parent:{ready:balanceReady,state:balanceReady?'READY':'STALE',balance:100000},subClient:{ready:balanceReady,state:balanceReady?'FUNDED':'PARENT_NOT_READY',availableBalance:balanceReady?100000:null},limit:{ready:true,state:'AVAILABLE',id:'LIMIT-MOCK',remainingAmount:2000,approvedAmount:2000}}});
 const dr=()=>({id:'DR-MOCK',clientId:'C-MOCK',projectId:'P-MOCK',sourceDocumentType:'PAYMENT_INSTRUCTION',sourceDocumentId:'PI-MOCK',purpose:'PAYROLL',destinationMode:'DIRECT_EMPLOYEE',clientReference:'DR/MOCK',status:drStatus,provider:'E2PAY',environment:'UAT',amount:2000,recipientCount:26,items:Array.from({length:26},(_,i)=>({id:'I-'+i,beneficiaryName:'Recipient '+(i+1),bankCode:'BCA',accountLast4:'1234',amount:2000/26}))});
 let requests=role==='PAYROLL_CONTROLLER'?[{id:'LIMIT-MOCK',clientId:'C-MOCK',clientName:'Mock Client',environment:'UAT',status:'PENDING_APPROVAL',requestedAmount:2000,remainingAmount:0}]:[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',async route=>{const req=route.request();const url=new URL(req.url());if(url.origin!==base){await route.abort();return;}if(!url.pathname.startsWith('/api/'))return route.continue();
 if(approvalMode&&url.pathname==='/api/e2pay-subaccounts')throw new Error('Master approval must never use sub-account endpoint');
 if(approvalMode&&url.pathname==='/api/e2pay-operations'&&url.searchParams.get('resource')==='account'){
  assert.equal(url.searchParams.get('refresh'),'1');balanceReads++;
  if(balanceFails){balanceFails=false;await route.fulfill({status:502,contentType:'application/json',body:JSON.stringify({error:'Synthetic Master balance unavailable'})});return;}
  balanceReady=true;
 }
 if(expired&&url.pathname==='/api/operating-model'){await route.fulfill({status:401,contentType:'application/json',body:JSON.stringify({error:'Authentication required'})});return;}
 let body={ok:true,periods:['2026-10'],submissions:[],paymentInstructions:[],paymentProofs:[],reconciliations:[],exceptions:[],requests:[],funding:[],records:[],clients:[],projects:[],employees:[],servicePlans:[],arItems:[],invoices:[],billablePayments:[],issuerProfile:null,portfolioSummary:{clients:0}};
 if(req.method()!=='GET'){
  const data=req.postDataJSON();actions.push(data.action);
  if(data.action==='BIND_MASTER_ACCOUNT'){
   assert.equal(role,'SUPER_ADMIN');
   if(!mfaVerified){await route.fulfill({status:428,contentType:'application/json',body:JSON.stringify({error:'MFA step-up diperlukan untuk registrasi Master Account',code:'MFA_STEP_UP_REQUIRED'})});return;}
   bound=true;
  }
  else if(url.pathname==='/api/security-mfa'&&data.action==='STEP_UP'){assert.equal(data.code,'123456');mfaVerified=true;}
  else if(data.action==='REQUEST_LIMIT'){assert.equal(role,'PAYROLL_PROCESSOR');assert.equal(data.clientId,'C-MOCK');assert.equal(data.amount,2000);requests=[{id:'LIMIT-MOCK',clientId:'C-MOCK',environment:'UAT',status:'PENDING_APPROVAL',requestedAmount:2000,remainingAmount:0}];}
  else if(data.action==='APPROVE_LIMIT'){assert.equal(role,'PAYROLL_CONTROLLER');requests[0].status='ACTIVE';requests[0].remainingAmount=2000;}
  else if(approvalMode&&data.action==='APPROVE_PAYMENT'){
   assert.ok(balanceReady,'Fresh Master balance required before PI approval');assert.equal(role,'PAYROLL_CONTROLLER');assert.equal(data.actionHash,'MOCK-HASH');
   if(!piRejected){piRejected=true;await route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({error:'Synthetic integrity refusal',code:'PI_TEST_REJECTION'})});return;}
   piStatus='APPROVED_FOR_PAYMENT';
  }
  else if(approvalMode&&data.action==='APPROVE_REQUEST'){
   assert.ok(balanceReady,'Fresh Master balance required before DR approval');assert.equal(role,'PAYROLL_CONTROLLER');assert.equal(data.id,'DR-MOCK');
   if(!mfaVerified){await route.fulfill({status:428,contentType:'application/json',body:JSON.stringify({error:'Verifikasi MFA diperlukan',code:'MFA_STEP_UP_REQUIRED'})});return;}
   drStatus='APPROVED';body={ok:true,request:dr()};
  }
  else if(reissueMode&&data.action==='REISSUE_FAILED'){assert.equal(role,'PAYROLL_PROCESSOR');assert.equal(data.id,'DR-MOCK');replacement=true;drStatus='READY';body={ok:true,request:{...dr(),id:'DR-REPLACEMENT',clientReference:'DR/REPLACEMENT'}};}
  else if(reissueMode&&data.action==='SUBMIT_REQUEST'){assert.equal(role,'PAYROLL_PROCESSOR');assert.equal(data.id,'DR-REPLACEMENT');drStatus='PENDING_APPROVAL';body={ok:true,request:{...dr(),id:'DR-REPLACEMENT'}};}
  else if(approvalMode&&data.action==='EXECUTE'){
   assert.equal(role,'PAYROLL_CONTROLLER');assert.equal(data.disbursementRequestId,'DR-MOCK');executionCalls++;
   if(executionCalls===1){drStatus='PROCESSING';body={ok:true,hasMore:true,phase:'INQUIRY',remaining:21,parentStatus:'PROCESSING'};}
   else if(executionCalls===2){drStatus='FAILED';await route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({error:'Synthetic inquiry rejected',code:'E2PAY_PREFLIGHT_FAILED'})});return;}
   else throw new Error('Failed batch must never be automatically retried');
  }
  else if(approvalMode&&data.action==='RECOVER_INTERRUPTED'){
   assert.equal(role,'PAYROLL_CONTROLLER');drStatus='RECONCILIATION_REQUIRED';body={ok:true,recovered:true,status:drStatus};
  }
  else throw new Error('Forbidden unexpected UI mutation '+data.action);
 }
 if(approvalMode&&url.pathname==='/api/operating-model'){
  body.paymentInstructions=[pi()];
  if(url.searchParams.get('resource')==='payment-instruction-detail')body={ok:true,paymentInstruction:pi(),lines:[],control:{expectedTotal:2000,totalAmount:2000,recipientCount:26,expectedRecipientCount:26,balanced:true,recipientBalanced:true},approvals:[],activity:[]};
 }
 if((approvalMode||reissueMode)&&url.pathname==='/api/disbursement-requests')body=url.searchParams.has('id')||req.method()==='POST'?{ok:true,request:replacement?{...dr(),id:'DR-REPLACEMENT',clientReference:'DR/REPLACEMENT'}:dr()}:{ok:true,requests:[replacement?{...dr(),id:'DR-REPLACEMENT',clientReference:'DR/REPLACEMENT'}:dr()]};
 if(url.pathname==='/api/operating-model'&&url.searchParams.get('resource')==='dashboard'&&role==='SUPER_ADMIN')body.clientBalances=[
  {clientId:'C-MOCK',clientName:'Mock Client',availableAmount:dashboardMasterChecked?5000:null,remainingLimit:6000,blocked:false,reasons:[],warnings:[],checkedAt:new Date().toISOString(),environment:'UAT'},
  {clientId:'C-BLOCK',clientName:'Blocked Client',availableAmount:0,remainingLimit:10000,blocked:true,reasons:[{code:'AR_OUTSTANDING_PAYMENT_BLOCKED',message:'Invoice overdue Rp 2.000. Pembayaran diblokir.'}],warnings:[],checkedAt:new Date().toISOString(),environment:'UAT'},
 ];
 if(url.pathname==='/api/me')body={authenticated:true,authMode:'session',user:{id:'MOCK-'+role,orgId:'ORG-MOCK',name:role,email:role+'@example.test',role,permissions:permissionsForRole(role),clientIds:['C-MOCK'],projectIds:[]}};
 if(url.pathname==='/api/client-projects')body={ok:true,clients:[{id:'C-MOCK',name:'Mock Client'}],projects:[{id:'P-MOCK',client_id:'C-MOCK',name:'Mock Project'}]};
 if(url.pathname==='/api/provider-channel-mappings')body={ok:true,routingMode:'AUTOMATIC',environment:'UAT',routes:[
  {purpose:'PAYROLL',destinationMode:'DIRECT_EMPLOYEE',beneficiaryType:'EMPLOYEE',ready:bound},
  {purpose:'PAYROLL',destinationMode:'CLIENT_ACCOUNT',beneficiaryType:'CORPORATE',ready:bound},
  {purpose:'EWA',destinationMode:'DIRECT_EMPLOYEE',beneficiaryType:'EMPLOYEE',ready:bound},
 ]};
 if(url.pathname==='/api/e2pay-operations'){
  if(url.searchParams.get('resource')==='master-activation')body={ok:true,environment:'UAT',registryId:bound?'MASTER-MOCK':null,connectionReady:bound,balance:100000,refreshedAt:new Date().toISOString(),checks:{credentialConfigured:true,registryActive:bound,identityMatched:bound,merchantActive:true,balanceFresh:true},channels:[]};
  else {if(role==='SUPER_ADMIN'&&url.searchParams.get('resource')==='overview'){await new Promise(resolve=>setTimeout(resolve,100));dashboardMasterChecked=true;}body={ok:true,account:{available:true,balance:100000,environment:'UAT',merchantStatus:'ACTIVE',refreshedAt:role==='SUPER_ADMIN'?new Date().toISOString():undefined}};}
 }
 if(url.pathname==='/api/e2pay-disbursement-limits')body={ok:true,funding:bound?[{providerAccountRegistryId:'MASTER-MOCK',environment:'UAT',clientId:null,parent:{ready:true,state:'READY',balance:100000},accountReadiness:{ready:true},limit:{ready:false}}]:[],requests};
 await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
 });
 await page.goto(base+'/?view=payments&paymentPanel=FUNDING',{waitUntil:'networkidle'});
 if(role==='SUPER_ADMIN'){
  await page.getByText('Lihat Detail Pemeriksaan Master',{exact:true}).click();await page.getByRole('button',{name:'Validasi & Aktifkan Master'}).click();await page.getByText('Identitas Master tervalidasi dan aktivasi tersimpan.').waitFor();assert.deepEqual(actions,['BIND_MASTER_ACCOUNT','STEP_UP','BIND_MASTER_ACCOUNT']);assert.equal(prompts,1);
  assert.equal(await page.getByRole('button',{name:'Ajukan ke Controller'}).count(),0);
 }else if(role==='PAYROLL_PROCESSOR'){
  assert.equal(await page.getByRole('button',{name:'Validasi & Aktifkan Master'}).count(),0);
  await page.getByText('Ajukan limit',{exact:true}).click();await page.getByLabel('Nominal (IDR)').fill('2000');await page.getByRole('button',{name:'Ajukan ke Controller'}).click();await page.getByText('Permintaan limit dikirim ke Payroll Controller.').waitFor();assert.deepEqual(actions,['REQUEST_LIMIT']);
 }else if(role==='PAYROLL_CONTROLLER'){
  assert.equal(await page.getByRole('button',{name:'Ajukan ke Controller'}).count(),0);await page.getByRole('button',{name:'Setujui',exact:true}).click();await page.getByText('Limit disetujui.').waitFor();assert.deepEqual(actions,['APPROVE_LIMIT']);
 }else{
  assert.equal(await page.getByRole('button',{name:'Validasi & Aktifkan Master'}).count(),0);assert.equal(await page.getByRole('button',{name:'Ajukan ke Controller'}).count(),0);assert.deepEqual(actions,[]);
 }
 if(role!=='CLIENT_USER'){
  const before=[...actions];
  await page.getByText('Pengaturan jalur pembayaran',{exact:true}).click();
  const routing=page.getByRole('region',{name:'Jalur Pembayaran Otomatis',exact:true});
  await routing.getByRole('heading',{name:'Payroll → Rekening Karyawan',exact:true}).waitFor();
  await routing.getByRole('heading',{name:'Payroll → Rekening Perusahaan Klien',exact:true}).waitFor();
  await routing.getByRole('heading',{name:'EWA → Rekening Karyawan',exact:true}).waitFor();
  assert.equal(await routing.locator('input,select').count(),0);
  await routing.getByRole('button',{name:'Periksa Koneksi',exact:true}).click();
  await routing.getByRole('button',{name:'Periksa Koneksi',exact:true}).waitFor();
  assert.deepEqual(actions,before,'Read-only routing view must never submit a mutation');
 }
 if(role==='PAYROLL_PROCESSOR'){
  reissueMode=true;drStatus='FAILED';
  await page.goto(base+'/?view=payments&paymentPanel=DISBURSEMENT',{waitUntil:'networkidle'});
  await page.getByRole('button',{name:'Ajukan ulang',exact:true}).click();
  await page.getByText('DR pengganti berhasil dibuat. Klik Submit untuk persetujuan Controller.',{exact:true}).waitFor();
  await page.getByRole('dialog',{name:'Immutable Disbursement Snapshot'}).getByRole('button',{name:'Tutup Immutable Disbursement Snapshot'}).click();
  await page.getByRole('button',{name:'Submit',exact:true}).click();
  await page.getByText('DR dikirim ke Payroll Controller.',{exact:true}).waitFor();
  assert.equal(drStatus,'PENDING_APPROVAL');assert.deepEqual(actions.slice(-2),['REISSUE_FAILED','SUBMIT_REQUEST']);
  assert.equal(actions.includes('EXECUTE'),false);assert.equal(actions.includes('APPROVE_REQUEST'),false);
 }
 if(role==='PAYROLL_CONTROLLER'){
  approvalMode=true;mfaVerified=false;
  await page.goto(base+'/?view=payments&paymentPanel=PI',{waitUntil:'networkidle'});
  await page.getByRole('button',{name:'Preview & Approve',exact:true}).click();
  const modal=page.getByRole('dialog',{name:'Detail Payment Instruction'});
  await modal.getByRole('checkbox',{name:'Kontrol utama PI sudah saya review.'}).check();
  await modal.getByRole('button',{name:'Approve & Continue',exact:true}).click();
  await modal.getByRole('alert').filter({hasText:'Synthetic Master balance unavailable'}).waitFor();
  assert.equal(actions.filter(action=>action==='APPROVE_PAYMENT').length,0,'Balance failure must stop approval');
  await modal.getByRole('button',{name:'Approve & Continue',exact:true}).click();
  await modal.getByRole('alert').filter({hasText:'Synthetic integrity refusal'}).waitFor();
  assert.equal(piStatus,'PAYMENT_APPROVAL_PENDING');
  await modal.getByRole('button',{name:'Approve & Continue',exact:true}).click();
  await modal.getByText('Approval tersimpan. Status PI telah diperbarui dari server.').waitFor();
  await modal.getByRole('button',{name:'Tutup detail Payment Instruction'}).click();
  await page.getByRole('tab',{name:/Disbursement/}).click();
  await page.getByRole('button',{name:'Review & Approve',exact:true}).click();
  const snapshot=page.getByLabel('Immutable Disbursement Snapshot');
  await expect(snapshot.locator('tbody tr')).toHaveCount(25);
  await snapshot.getByRole('button',{name:'Berikutnya',exact:true}).click();
  await expect(snapshot.locator('tbody tr')).toHaveCount(1);
  balanceReady=false;
  await snapshot.getByRole('button',{name:'Approve DR',exact:true}).click();
  await page.getByText('Disbursement Request disetujui oleh Controller.',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Process Payment',exact:true}).waitFor();
  assert.equal(drStatus,'APPROVED');
  assert.equal(balanceReads,4,'Each approval attempt must refresh Master balance, including DR');
  assert.deepEqual(actions.slice(-5),['APPROVE_PAYMENT','APPROVE_PAYMENT','APPROVE_REQUEST','STEP_UP','APPROVE_REQUEST']);
  await snapshot.getByRole('button',{name:'Tutup Immutable Disbursement Snapshot'}).click();
  await page.getByRole('button',{name:'Process Payment',exact:true}).click();
  await page.getByText(/Synthetic inquiry rejected/).waitFor();
  assert.equal(executionCalls,2);assert.equal(drStatus,'FAILED');
  await expect(page.getByRole('button',{name:'Process Payment',exact:true})).toHaveCount(0);
  drStatus='EXECUTING';await page.getByRole('button',{name:'Refresh status',exact:true}).click();
  await page.getByRole('button',{name:'Pulihkan status',exact:true}).click();
  await page.getByText('Status diperbarui. Tinjau kegagalan atau lanjutkan rekonsiliasi.',{exact:true}).waitFor();
  assert.equal(drStatus,'RECONCILIATION_REQUIRED');assert.equal(executionCalls,2);

 }
 assert.deepEqual(errors,[]);console.log(JSON.stringify({role,passed:true,simulatedActions:actions,externalNetwork:0,runtimeErrors:errors.length}));
 if(role==='SUPER_ADMIN'){
  const before=[...actions];dashboardMasterChecked=false;
  await page.goto(base+'/?view=dashboard',{waitUntil:'networkidle'});
  const balances=page.getByRole('region',{name:'Saldo tersedia per klien',exact:true});
  await balances.getByRole('heading',{name:'Available Saldo per Klien',exact:true}).waitFor();
  await expect(balances.locator('article')).toHaveCount(2);
  await expect(balances).toContainText('Rp 5.000');
  await expect(balances).toContainText('Invoice overdue Rp 2.000. Pembayaran diblokir.');
  assert.equal(await page.getByRole('heading',{name:'Deadline & SLA'}).count(),0);
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.setViewportSize({width:1280,height:900});
  assert.deepEqual(actions,before,'Dashboard availability is read-only');
  expired=true;
  await page.goto(base+'/?view=dashboard',{waitUntil:'networkidle'});
  await page.getByRole('button',{name:'Masuk ke ProQPay',exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Validasi & Aktifkan Master'}).count(),0);
  assert.deepEqual(errors,[]);
 }
  }finally{await browser.close();}
 });
}

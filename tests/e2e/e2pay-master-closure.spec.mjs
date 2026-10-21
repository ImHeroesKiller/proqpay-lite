import {test,chromium} from '@playwright/test';
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
let bound=role!=='SUPER_ADMIN';let mfaVerified=false;let expired=false;const actions=[];const errors=[];let prompts=0;
 page.on('dialog',async dialog=>{assert.equal(dialog.type(),'prompt');prompts++;await dialog.accept('123456');});
 let requests=role==='PAYROLL_CONTROLLER'?[{id:'LIMIT-MOCK',clientId:'C-MOCK',clientName:'Mock Client',environment:'UAT',status:'PENDING_APPROVAL',requestedAmount:2000,remainingAmount:0}]:[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',async route=>{const req=route.request();const url=new URL(req.url());if(url.origin!==base){await route.abort();return;}if(!url.pathname.startsWith('/api/'))return route.continue();
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
  else throw new Error('Forbidden unexpected UI mutation '+data.action);
 }
 if(url.pathname==='/api/me')body={authenticated:true,authMode:'session',user:{id:'MOCK-'+role,orgId:'ORG-MOCK',name:role,email:role+'@example.test',role,permissions:permissionsForRole(role),clientIds:['C-MOCK'],projectIds:[]}};
 if(url.pathname==='/api/client-projects')body={ok:true,clients:[{id:'C-MOCK',name:'Mock Client'}],projects:[{id:'P-MOCK',client_id:'C-MOCK',name:'Mock Project'}]};
 if(url.pathname==='/api/e2pay-operations'){
  if(url.searchParams.get('resource')==='master-activation')body={ok:true,environment:'UAT',registryId:bound?'MASTER-MOCK':null,connectionReady:bound,balance:100000,refreshedAt:new Date().toISOString(),checks:{credentialConfigured:true,registryActive:bound,identityMatched:bound,merchantActive:true,balanceFresh:true},channels:[]};
  else body={ok:true,account:{available:true,balance:100000,environment:'UAT',merchantStatus:'ACTIVE'}};
 }
 if(url.pathname==='/api/e2pay-disbursement-limits')body={ok:true,funding:bound?[{providerAccountRegistryId:'MASTER-MOCK',environment:'UAT',clientId:null,parent:{ready:true,state:'READY',balance:100000},accountReadiness:{ready:true},limit:{ready:false}}]:[],requests};
 await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
 });
 await page.goto(base+'/?view=payments&paymentPanel=FUNDING',{waitUntil:'networkidle'});
 if(role==='SUPER_ADMIN'){
  await page.getByRole('button',{name:'Validasi & Aktifkan Master'}).click();await page.getByText('Identitas Master tervalidasi dan aktivasi tersimpan.').waitFor();assert.deepEqual(actions,['BIND_MASTER_ACCOUNT','STEP_UP','BIND_MASTER_ACCOUNT']);assert.equal(prompts,1);
  assert.equal(await page.getByRole('button',{name:'Ajukan ke Controller'}).count(),0);
 }else if(role==='PAYROLL_PROCESSOR'){
  assert.equal(await page.getByRole('button',{name:'Validasi & Aktifkan Master'}).count(),0);
  await page.getByLabel('Nominal (IDR)').fill('2000');await page.getByRole('button',{name:'Ajukan ke Controller'}).click();await page.getByText('Permintaan limit dikirim ke Payroll Controller.').waitFor();assert.deepEqual(actions,['REQUEST_LIMIT']);
 }else if(role==='PAYROLL_CONTROLLER'){
  assert.equal(await page.getByRole('button',{name:'Ajukan ke Controller'}).count(),0);await page.getByRole('button',{name:'Setujui',exact:true}).click();await page.getByText('Limit disetujui.').waitFor();assert.deepEqual(actions,['APPROVE_LIMIT']);
 }else{
  assert.equal(await page.getByRole('button',{name:'Validasi & Aktifkan Master'}).count(),0);assert.equal(await page.getByRole('button',{name:'Ajukan ke Controller'}).count(),0);assert.deepEqual(actions,[]);
 }
 assert.deepEqual(errors,[]);console.log(JSON.stringify({role,passed:true,simulatedActions:actions,externalNetwork:0,runtimeErrors:errors.length}));
 if(role==='SUPER_ADMIN'){
  expired=true;
  await page.goto(base+'/?view=dashboard',{waitUntil:'networkidle'});
  await page.getByRole('button',{name:'Masuk ke ProQPay',exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Validasi & Aktifkan Master'}).count(),0);
  assert.deepEqual(errors,[]);
 }
  }finally{await browser.close();}
 });
}

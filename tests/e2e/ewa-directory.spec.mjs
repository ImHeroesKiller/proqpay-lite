import {test,expect} from '@playwright/test';
import {permissionsForRole} from '../../shared/authority-matrix.js';
const base=process.env.EWA_TEST_URL||process.env.BASE_URL||'http://127.0.0.1:8137';
for(const width of [390,1440])for(const role of ['CLIENT_USER','PAYROLL_PROCESSOR'])test(`EWA directory ${role} ${width}`,async({page})=>{
 if(!['localhost','127.0.0.1'].includes(new URL(base).hostname))throw Error('Synthetic localhost only');
 await page.setViewportSize({width,height:1000});const errors=[],calls=[];let saved=null;page.on('pageerror',e=>errors.push(e.message));
 const clients=[{id:'C',name:'Klien Existing'}],projects=[{id:'P',client_id:'C',name:'Project Existing'}];
 const employee={id:'E',employee_code:'TEST-001',name:'Karyawan Existing',client_id:'C',project_id:'P',client_name:clients[0].name,project_name:projects[0].name,ewa_enabled:0};
 await page.route('**/*',async route=>{
  const req=route.request(),u=new URL(req.url());if(u.origin!==base)return route.abort();if(!u.pathname.startsWith('/api/'))return route.continue();calls.push(u.pathname+u.search);
  let body={ok:true,periods:[],submissions:[],employees:[],clients,projects,requests:[],paymentInstructions:[],records:[],invoices:[],arItems:[],servicePlans:[],statusCounts:{},page:{hasMore:false,nextOffset:0}};
  if(u.pathname==='/api/me')body={authenticated:true,authMode:'session',user:{id:'TEST',orgId:'O',email:'test@example.test',name:'Penti',role,permissions:permissionsForRole(role),clientIds:['C'],projectIds:[]}};
  if(u.pathname==='/api/ewa')body={ok:true,requests:[{id:'R',employee_id:'E',employee_name:'Karyawan Existing',client_id:'C',client_name:'Klien Existing',period:'2026-11',amount:200000,status:'APPROVED',client_approval_status:'APPROVED'}],clients,total:1,pending:0,filteredTotal:1,statusCounts:{APPROVED:1},page:{hasMore:false,nextOffset:1}};
  if(u.pathname==='/api/employees')body={employees:[{id:'E',employeeCode:'TEST-001',name:'Karyawan Existing',company:'Klien Existing',project:'Project Existing',status:'ACTIVE',isActive:true}],meta:{nextOffset:null}};
  if(u.pathname==='/api/ewa-enrollment'){
   if(req.method()==='POST'){saved=req.postDataJSON();body={ok:true,settings:{version:1},basis:{salary:1000000,period:'2026-01',source:'IMPORTED_PAYROLL'},limit:450000};}
   else if(u.searchParams.has('employeeId'))body={ok:true,settings:null,canWrite:true,basis:{salary:1000000,period:'2026-01',source:'IMPORTED_PAYROLL'},limit:0};
   else body={ok:true,employees:[employee],clients,projects,canWrite:true,hasMore:false};
  }
  await route.fulfill({json:body});
 });
 await page.goto(base+'/?view=ewa',{waitUntil:'networkidle'});
 await expect(page.getByRole('heading',{name:'Persetujuan Advance Salary',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Karyawan & Limit',exact:true})).toHaveCount(0);
 await expect(page.getByText('Daftarkan karyawan baru',{exact:true})).toHaveCount(0);
 await expect(page.getByLabel('Aktifkan EWA')).toHaveCount(0);
 if(role==='PAYROLL_PROCESSOR'){
  await page.locator(width===1440?'.ewa-desktop':'.ewa-mobile').getByRole('link',{name:'Buka pembayaran',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Disbursement Request & Execution',exact:true})).toBeVisible();
  await expect(page.getByLabel('EWA Request',{exact:true})).toHaveValue('R');
 }
 await page.goto(base+'/?view=employees',{waitUntil:'networkidle'});
 await expect(page.getByRole('heading',{name:'Data Karyawan',exact:true})).toBeVisible();
 if(width===1440)await page.getByRole('row').filter({hasText:'Karyawan Existing'}).click();
 else await page.getByRole('button',{name:/Karyawan Existing.*Lihat detail/}).click();
 if(role==='CLIENT_USER')await expect(page.getByRole('button',{name:'Generate password ESS',exact:true})).toHaveCount(0);
 const profile=page.getByRole('dialog',{name:'Profil Karyawan',exact:true});
 await profile.getByRole('tab',{name:'EWA',exact:true}).click();
 await expect(page.getByText('Gaji acuan tersimpan:',{exact:false})).toBeVisible();
 await page.screenshot({path:`/tmp/ewa-payroll-${role}-${width}.png`,fullPage:true});
 await page.getByLabel('Aktifkan EWA').check();await page.getByLabel('Metode limit').selectOption('FIXED');await page.getByLabel('Limit khusus (Rp)').fill('450000');await page.getByLabel('Alasan perubahan').fill('Persetujuan limit dari klien');await page.getByRole('button',{name:'Simpan pengaturan EWA'}).click();
 await expect.poll(()=>saved?.fixedLimit).toBe(450000);expect(saved.enabled).toBe(true);expect(saved.employeeId).toBe('E');
 await expect(page.getByText(/Pengaturan EWA tersimpan/)).toBeVisible();expect(errors).toEqual([]);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 if(role==='CLIENT_USER'){expect(calls).not.toContain('/api/state');expect(calls).not.toContain('/api/operating-model?resource=service-plans');}
});

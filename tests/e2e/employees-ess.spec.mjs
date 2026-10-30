import {test,expect,chromium} from '@playwright/test';
import {permissionsForRole} from '../../shared/authority-matrix.js';
import {mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const base=process.env.BASE_URL||'http://127.0.0.1:39822';
const employees=[
 {id:'EMP-ESS-TEST',employeeCode:'TEST-001',name:'Karyawan Pengujian',company:'Klien Pengujian',project:'Project Pengujian',isActive:true,status:'ACTIVE',salaryGross:5000000,bankName:'BCA',accountNo:'1234567890',essStatus:'NOT_ISSUED'},
 {id:'EMP-ESS-INACTIVE',employeeCode:'TEST-002',name:'Karyawan Nonaktif',company:'Klien Pengujian',isActive:false,status:'RESIGN',essStatus:'INACTIVE'},
];
for(const width of [1440,390])test(`employee ESS individual generation, errors, status and transient password at ${width}px`,async()=>{
 test.setTimeout(90000);
 if(!['127.0.0.1','localhost'].includes(new URL(base).hostname))throw new Error('Local synthetic APIs only');
 const browser=await chromium.launch({executablePath:process.env.E2PAY_CHROMIUM_EXECUTABLE,headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--no-zygote','--single-process']});
 try{
 const page=await browser.newPage({viewport:{width,height:950},bypassCSP:true});await page.emulateMedia({reducedMotion:'reduce'});
 let writes=0,fail=true;const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());if(url.origin!==base)return route.abort();if(!url.pathname.startsWith('/api/'))return route.continue();
  if(url.pathname==='/api/employee-credentials'){
   expect(request.method()).toBe('POST');expect(request.postDataJSON()).toEqual({action:'RESET',employeeId:'EMP-ESS-TEST'});writes++;
   return route.fulfill({status:fail?409:200,json:fail?{error:'Synthetic ESS reset unavailable'}:{ok:true,employee:{employeeId:'EMP-ESS-TEST',password:'Synthetic-Only-Pw-001!'}}});
  }
  if(request.method()!=='GET')throw new Error('Unexpected write '+url.pathname);
  let body={ok:true,periods:[],submissions:[],employees:[],clients:[],projects:[],paymentInstructions:[],records:[],requests:[],invoices:[],arItems:[],servicePlans:[]};
  if(url.pathname==='/api/me')body={authenticated:true,authMode:'session',user:{id:'ESS-TEST-PROCESSOR',orgId:'TEST',name:'Pengguna Pengujian',role:'PAYROLL_PROCESSOR',permissions:permissionsForRole('PAYROLL_PROCESSOR'),clientIds:[],projectIds:[]}};
  if(url.pathname==='/api/employees')body={employees,meta:{nextOffset:null}};
  await route.fulfill({json:body});
 });
 await page.goto(base+'/?view=employees',{waitUntil:'networkidle'});
 await expect(page.getByRole('heading',{name:'Data Karyawan',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Kelola akses ESS',exact:true})).toHaveCount(0);
 await expect(page.getByText('Perlu dilengkapi',{exact:true})).toHaveCount(0);
 await expect(page.getByRole('columnheader',{name:'Kelengkapan',exact:true})).toHaveCount(0);
 await expect(page.getByRole('columnheader',{name:'Kontrak',exact:true})).toHaveCount(0);
 const open=page.getByRole('button',{name:width===1440?'Lihat detail Karyawan Pengujian':/Karyawan Pengujian.*Lihat detail/});
 await open.click();const profile=page.getByRole('dialog',{name:'Profil Karyawan',exact:true});
 await expect(profile.getByLabel('Password ESS',{exact:true})).toHaveValue('');expect(writes).toBe(0);
 await profile.getByRole('button',{name:'Generate password ESS',exact:true}).click();
 const confirmation=page.getByRole('dialog',{name:'Generate password ESS?',exact:true});
 await confirmation.getByRole('button',{name:'Batal',exact:true}).click();expect(writes).toBe(0);
 await profile.getByRole('button',{name:'Generate password ESS',exact:true}).click();
 await confirmation.getByRole('button',{name:'Ya, generate password',exact:true}).click();
 await expect(confirmation.getByRole('alert')).toHaveText('Synthetic ESS reset unavailable');expect(writes).toBe(1);
 fail=false;await confirmation.getByRole('button',{name:'Ya, generate password',exact:true}).click();
 await expect(confirmation).toHaveCount(0);await expect(profile.getByLabel('Password ESS',{exact:true})).toHaveValue('Synthetic-Only-Pw-001!');
 await expect(profile.getByRole('status').filter({hasText:'Status ESS:'})).toHaveText('Status ESS: Wajib ganti password');
 await page.context().grantPermissions(['clipboard-read','clipboard-write']);
 await profile.getByRole('button',{name:'Salin password',exact:true}).click();
 await expect(profile.getByText('Password berhasil disalin.',{exact:true})).toBeVisible();
 expect(await page.evaluate(()=>navigator.clipboard.readText())).toBe('Synthetic-Only-Pw-001!');
 await page.addScriptTag({path:fileURLToPath(new URL('../../node_modules/axe-core/axe.min.js',import.meta.url))});
 const violations=await page.evaluate(async()=>{const result=await window.axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa']}});return result.violations.map(v=>({id:v.id,targets:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))}));});expect(violations).toEqual([]);
 await mkdir('artifacts/employees-ess',{recursive:true});await page.screenshot({path:`artifacts/employees-ess/detail-${width}.png`,fullPage:true});
 await profile.getByRole('button',{name:'Tutup profil',exact:true}).click();await expect(profile).toHaveCount(0);
 await open.click();await expect(profile.getByLabel('Password ESS',{exact:true})).toHaveValue('');
 await page.keyboard.press('Escape');await expect(profile).toHaveCount(0);
 const inactive=page.getByRole('button',{name:width===1440?'Lihat detail Karyawan Nonaktif':/Karyawan Nonaktif.*Lihat detail/});await inactive.click();
 await expect(profile.getByRole('button',{name:'Generate password ESS',exact:true})).toBeDisabled();
 await page.keyboard.press('Escape');
 await page.getByRole('button',{name:'Filter',exact:true}).click();await page.getByLabel('Status ESS',{exact:true}).selectOption('PASSWORD_CHANGE_REQUIRED');
 await expect(page.locator('.employee-table-meta')).toContainText('1 karyawan');
 await page.screenshot({path:`artifacts/employees-ess/directory-${width}.png`,fullPage:true});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBeTruthy();expect(writes).toBe(2);expect(errors).toEqual([]);
 }finally{await browser.close();}
});

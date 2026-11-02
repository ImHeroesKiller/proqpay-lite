import {test,expect} from '@playwright/test';
import {permissionsForRole} from '../../shared/authority-matrix.js';
import {mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
test.use({bypassCSP:true});
const base=process.env.BASE_URL||'http://127.0.0.1:8140';
const row={id:'EWA-TEST-001',employee_id:'EMP-TEST',employee_name:'Ari Pratama',employee_code:'TEST-001',client_id:'C',client_name:'PT Klien Pengujian',period:'2026-11',amount:120000,fee:50000,repayment:170000,salary_reference_snapshot:915659,salary_source_period_snapshot:'2026-01',status:'SUBMITTED',client_approval_status:'PENDING',created_at:'2026-11-02T06:24:00Z',updated_at:'2026-11-02T06:24:00Z'};
async function fixture(page,{role='CLIENT_USER',rows=[row],width=1440,fail=false}={}){
 if(!['127.0.0.1','localhost'].includes(new URL(base).hostname))throw Error('Synthetic localhost only');
 await page.setViewportSize({width,height:width===1440?1000:1100});let writes=0,lastWrite=null;const queries=[],errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',async route=>{const req=route.request(),u=new URL(req.url());if(u.origin!==base)return route.abort();if(!u.pathname.startsWith('/api/'))return route.continue();
 let body={ok:true,periods:[],submissions:[],employees:[],clients:[{id:'C',name:'PT Klien Pengujian'}],projects:[],requests:[],paymentInstructions:[],records:[],invoices:[],arItems:[],servicePlans:[]};
 if(u.pathname==='/api/me')body={authenticated:true,authMode:'session',user:{id:'TEST',orgId:'TEST',name:'Admin Payroll',email:'test@example.test',role,permissions:permissionsForRole(role),clientIds:['C'],projectIds:[]}};
 if(u.pathname==='/api/employees')body={employees:[],meta:{nextOffset:null}};
 if(u.pathname==='/api/ewa'){
  if(req.method()==='POST'){writes++;lastWrite=req.postDataJSON();if(fail)return route.fulfill({status:409,json:{error:'Status berubah. Muat ulang.'}});const current=rows.find(r=>r.id===lastWrite.id);if(lastWrite.action==='REJECT'){current.status='REJECTED';current.decision_note=lastWrite.note;}else if(role==='CLIENT_USER')current.client_approval_status='APPROVED';else current.status='APPROVED';body={ok:true,request:current};}
  else {queries.push(u.searchParams);const q=(u.searchParams.get('q')||'').toLowerCase(),client=u.searchParams.get('clientId'),period=u.searchParams.get('period'),status=u.searchParams.get('status');const scoped=rows.filter(r=>(!q||(r.employee_name+r.employee_code+r.id).toLowerCase().includes(q))&&(!client||r.client_id===client)&&(!period||r.period===period));const statusCounts={};for(const r of scoped)statusCounts[r.status]=(statusCounts[r.status]||0)+1;const filtered=scoped.filter(r=>!status||r.status===status),offset=Number(u.searchParams.get('offset')||0),limit=Number(u.searchParams.get('limit')||50);body={...body,pending:statusCounts.SUBMITTED||0,total:scoped.length,statusCounts,filteredTotal:filtered.length,requests:filtered.slice(offset,offset+limit),page:{hasMore:offset+limit<filtered.length,nextOffset:offset+limit}};}
 }
 await route.fulfill({json:body});});
 await page.goto(base+'/?view=ewa',{waitUntil:'networkidle'});await expect(page.getByRole('heading',{name:'Persetujuan Advance Salary',exact:true})).toBeVisible();
 return {get writes(){return writes;},get lastWrite(){return lastWrite;},queries,errors};
}
for(const width of [390,1440])test(`approval visual and reject ${width}`,async({page})=>{
 const f=await fixture(page,{width,rows:[{...row}]});const scope=page.locator(width===1440?'.ewa-desktop':'.ewa-mobile');
 await expect(scope.getByText('Ari Pratama',{exact:true})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await mkdir('artifacts/ewa-approval',{recursive:true});await page.screenshot({path:`artifacts/ewa-approval/${width===1440?'desktop':'mobile'}.png`,fullPage:true});
 await scope.getByRole('button',{name:'Detail Ari Pratama'}).click();const detail=page.getByRole('dialog',{name:'Detail pengajuan advance'});await expect(detail.getByText(/Total potong payroll/).locator('..')).toContainText('Rp 170.000');await expect(detail.getByText(/915.659/)).toBeVisible();await page.keyboard.press('Escape');await expect(detail).toHaveCount(0);
 await scope.getByRole('button',{name:'Tolak',exact:true}).click();const reject=page.getByRole('dialog',{name:'Tolak pengajuan advance?'});await expect(reject.getByRole('button',{name:'Konfirmasi penolakan'})).toBeDisabled();await reject.getByLabel('Alasan penolakan').fill('Dokumen perlu dikoreksi');await reject.getByRole('button',{name:'Konfirmasi penolakan'}).dblclick();await expect.poll(()=>f.writes).toBe(1);expect(f.lastWrite.note).toBe('Dokumen perlu dikoreksi');await expect(page.getByText('Penolakan dan alasannya berhasil disimpan.')).toBeVisible();expect(f.errors).toEqual([]);
});
for(const [role,consent,decisions] of [['CLIENT_USER','PENDING',true],['CLIENT_USER','APPROVED',false],['PAYROLL_PROCESSOR','PENDING',false],['PAYROLL_PROCESSOR','APPROVED',true],['PAYROLL_CONTROLLER','APPROVED',false]])test(`decision stage ${role} ${consent}`,async({page})=>{
 const f=await fixture(page,{role,rows:[{...row,client_approval_status:consent}]});const buttons=page.locator('.ewa-desktop').getByRole('button',{name:'Setujui',exact:true});await expect(buttons).toHaveCount(decisions?1:0);
 if(decisions){await buttons.click();await expect(page.getByRole('dialog',{name:'Setujui pengajuan advance?'})).toBeVisible();expect(f.writes).toBe(0);await page.getByRole('button',{name:'Konfirmasi persetujuan'}).dblclick();await expect.poll(()=>f.writes).toBe(1);await expect(page.getByText('Persetujuan berhasil disimpan.')).toBeVisible();}
});
test('KPI filters, existing client, query, period, pagination and refresh',async({page})=>{
 const f=await fixture(page,{rows:Array.from({length:26},(_,i)=>({...row,id:`EWA-${i}`,employee_name:`Karyawan ${String(i).padStart(2,'0')}`})).concat([{...row,id:'READY',status:'APPROVED',employee_name:'Siap cair'}])});
 await page.getByRole('button',{name:/Siap Cair/}).click();await expect(page.locator('.ewa-desktop').getByText('Siap cair',{exact:true})).toBeVisible();await expect.poll(()=>f.queries.at(-1).get('status')).toBe('APPROVED');
 await page.getByRole('button',{name:/Menunggu/}).click();await page.getByLabel('Jumlah baris per halaman').selectOption('25');await page.getByRole('button',{name:'Berikutnya',exact:true}).click();await expect.poll(()=>f.queries.at(-1).get('offset')).toBe('25');
 await page.getByLabel('Filter klien').selectOption('C');await page.getByLabel('Filter periode').fill('2026-11');await page.getByLabel('Cari pengajuan advance').fill('Karyawan 00');await expect(page.locator('.ewa-desktop').getByText('Karyawan 00',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Refresh Data',exact:true}).click();await expect.poll(()=>f.queries.at(-1).get('q')).toBe('Karyawan 00');await expect(page.getByLabel('Filter klien')).toHaveValue('C');await expect(page.getByLabel('Filter periode')).toHaveValue('2026-11');
 await page.getByRole('button',{name:'Reset filter',exact:true}).click();await expect(page.getByLabel('Filter status')).toHaveValue('');expect(f.writes).toBe(0);
});
test('failed rejection keeps reason and confirmation open without a success state',async({page})=>{
 const f=await fixture(page,{fail:true,rows:[{...row}]});await page.locator('.ewa-desktop').getByRole('button',{name:'Tolak',exact:true}).click();const d=page.getByRole('dialog');await d.getByLabel('Alasan penolakan').fill('Ditolak berdasarkan evaluasi');await d.getByRole('button',{name:'Konfirmasi penolakan'}).click();await expect(d.getByRole('alert')).toContainText('Status berubah');await expect(d.getByLabel('Alasan penolakan')).toHaveValue('Ditolak berdasarkan evaluasi');expect(f.writes).toBe(1);
});
test('approval dashboard passes axe with synthetic data',async({page})=>{
 await fixture(page,{rows:[{...row}]});await page.addScriptTag({path:fileURLToPath(new URL('../../node_modules/axe-core/axe.min.js',import.meta.url))});const violations=await page.evaluate(async()=>{const r=await window.axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}});return r.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)}));});expect(violations).toEqual([]);
});

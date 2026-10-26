import {test,expect} from '@playwright/test';
import {build} from 'esbuild';

// Synthetic component mount, no user session or financial request.
test.use({bypassCSP:true});
let fixtureJS;
async function fixture(){
 if(fixtureJS)return fixtureJS;
 const code=`import React,{useState} from 'react';import{createRoot}from'react-dom/client';
 import{Tabs}from'./src/components/ui/UnifiedSystem.tsx';
 function Demo(){const[value,setValue]=useState('clients');return <>
 <Tabs ariaLabel="G4 Keyboard Tabs" value={value} onChange={setValue} items={[
 {value:'clients',label:'Klien'},{value:'projects',label:'Project'},{value:'documents',label:'Dokumen'},
 ]}/><p id="g4-selection">{value}</p></>};const root=document.createElement('div');root.id='g4-tabs-fixture';document.body.append(root);createRoot(root).render(<Demo/>);`;
 const x=await build({stdin:{contents:code,loader:'tsx',resolveDir:process.cwd(),sourcefile:'g4-keyboard.tsx'},bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'}});
 fixtureJS=x.outputFiles[0].text;return fixtureJS;
}
test('G4 shared tabs support arrow navigation, Home/End and roving focus without extra tabbable controls',async({page})=>{
 await page.goto('/',{waitUntil:'domcontentloaded'});await page.addScriptTag({content:await fixture()});
 const tabs=page.getByRole('tablist',{name:'G4 Keyboard Tabs'}).getByRole('tab');
 await expect(tabs).toHaveCount(3);
 await expect(tabs.nth(0)).toHaveAttribute('aria-selected','true');
 await expect(tabs.nth(0)).toHaveAttribute('tabindex','0');
 await expect(tabs.nth(1)).toHaveAttribute('tabindex','-1');
 await tabs.nth(0).focus();await page.keyboard.press('ArrowRight');
 await expect(tabs.nth(1)).toBeFocused();await expect(tabs.nth(1)).toHaveAttribute('aria-selected','true');
 await expect(page.locator('#g4-selection')).toHaveText('projects');
 await page.keyboard.press('End');await expect(tabs.nth(2)).toBeFocused();
 await page.keyboard.press('ArrowRight');await expect(tabs.nth(0)).toBeFocused();
 await page.keyboard.press('Home');await expect(tabs.nth(0)).toHaveAttribute('aria-selected','true');
 await page.keyboard.press('ArrowLeft');await expect(tabs.nth(2)).toBeFocused();
 expect(await tabs.evaluateAll(nodes=>nodes.filter(node=>node.tabIndex===0).length)).toBe(1);
});

test('G4 reports tabs support roving focus and keyboard navigation in read-only role UAT',async({page})=>{
 await page.route('**/api/**',async route=>{
  const req=route.request(),path=new URL(req.url()).pathname;
  if(req.method()!=='GET')return route.fulfill({status:405,body:'{}'});
  const body=path==='/api/me'?{authenticated:true,authMode:'session',user:{id:'G4',orgId:'G4',name:'G4',email:'g4@example.test',role:'SUPER_ADMIN',permissions:[]}}
    :{ok:true,periods:['2026-09'],submissions:[],paymentInstructions:[],paymentProofs:[],reconciliations:[],exceptions:[],records:[],requests:[],funding:[],clients:[],projects:[],employees:[],arItems:[],invoices:[],servicePlans:[]};
  return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
 });
 await page.goto('/?view=reports',{waitUntil:'networkidle'});
 const tabs=page.getByRole('tablist',{name:'Jenis laporan'}).getByRole('tab');
 await expect(tabs.first()).toHaveAttribute('aria-selected','true');
 await tabs.first().focus();await page.keyboard.press('ArrowRight');
 await expect(tabs.nth(1)).toBeFocused();
 await expect(tabs.nth(1)).toHaveAttribute('aria-selected','true');
 expect(await tabs.evaluateAll(nodes=>nodes.filter(node=>node.tabIndex===0).length)).toBe(1);
});

for(const role of ['PAYROLL_PROCESSOR','PAYROLL_CONTROLLER'])test(`Exception Center deep link, refresh and return preserve the correct view for ${role}`,async({page})=>{
 let writes=0;
 const submission={id:'SUB-EX-SCOPE',client_id:'CLI-EX',client_name:'UAT Scoped Client',project_id:'PRJ-EX',project_name:'UAT 200',period:'2026-11',payment_period:'2026-11',state:'EXCEPTION_FOUND',input_status:'PENDING',period_status:'OPEN',source_mode:'UPLOAD_FINAL',service_tier:'TIER_1_PAYMENT_PROCESSING',employee_count:200,total_net:3000000,blocking_count:1,exception_count:1};
 const other={...submission,id:'SUB-EX-OTHER',project_name:'Unrelated Project'};
 const exception={id:'EX-SCOPE',submission_id:submission.id,client_id:submission.client_id,client_name:submission.client_name,project_name:submission.project_name,period:submission.period,category:'SYSTEM_EMPLOYEE_MISSING',severity:'CRITICAL',status:'OPEN',reason:'Missing prior dummy employee',field:'employeeScope'};
 await page.route('**/api/**',async route=>{
  const req=route.request(),path=new URL(req.url()).pathname;
  if(req.method()!=='GET'){writes++;return route.fulfill({status:405,body:'{}'});}
  const body=path==='/api/me'?{authenticated:true,authMode:'session',user:{id:'EX-UAT',orgId:'ORG-OTSINDO',name:'Exception UAT',email:'exception@example.test',role,permissions:['read','submission:write','payroll:write','exception:write']}}
   :{ok:true,periods:['2026-11'],submissions:[submission,other],submission,paymentInstructions:[],paymentProofs:[],reconciliations:[],exceptions:[exception,{...exception,id:'EX-OTHER',submission_id:other.id,reason:'Unrelated finding'}],exceptionHistory:[],records:[],requests:[],funding:[],clients:[],projects:[],employees:[],arItems:[],invoices:[],servicePlans:[],lines:[],variance:{}};
  return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
 });
 await page.goto('/?view=exceptions&stage=payroll&submissionId=SUB-EX-SCOPE',{waitUntil:'networkidle'});
 await expect(page.getByRole('heading',{name:'Exception Center',exact:true})).toBeVisible();
 await expect(page.getByText('Unrelated finding',{exact:false})).toHaveCount(0);
 const detail=page.getByRole('button',{name:'Tindak lanjut',exact:true});
 await expect(detail).toBeVisible();await detail.click();
 await expect(page.getByRole('dialog',{name:'Detail exception payroll'})).toBeVisible();
 await page.getByRole('button',{name:'Tutup detail exception'}).click();
 await page.reload({waitUntil:'networkidle'});
 await expect(page.getByRole('heading',{name:'Exception Center',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Kembali ke Payroll',exact:true}).click();
 await expect(page).toHaveURL(/view=operations/);
 await expect(page.getByRole('heading',{name:'Exception Center',exact:true})).toHaveCount(0);
 await page.goBack({waitUntil:'networkidle'});
 await expect(page.getByRole('heading',{name:'Exception Center',exact:true})).toBeVisible();
 await page.getByRole('button',{name:/Data & Payroll/}).click();
 await expect(page).toHaveURL(/view=operations/);
 expect(writes).toBe(0);
});

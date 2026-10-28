import{test,expect}from'@playwright/test';
import{build}from'esbuild';

test.use({bypassCSP:true});

let scriptSource;
async function fixture(){
 if(scriptSource)return scriptSource;
 const source=`import React,{useState} from 'react';
 import{createRoot}from'react-dom/client';
 import{ModalShell}from './src/components/ui/UnifiedSystem.tsx';
 function Demo(){const[open,setOpen]=useState(false);const[nested,setNested]=useState(false);
  return <><button id="g3-open" onClick={()=>setOpen(true)}>Open G3 dialog</button><button id="g3-outside">Outside</button>
  {open&&<ModalShell title="G3 Main Dialog" onClose={()=>setOpen(false)}>
   <input id="g3-field" aria-label="Test field"/>
   <button id="g3-child" onClick={()=>setNested(true)}>Nested G3</button>
   <button id="g3-last">Last control</button>
   {nested&&<ModalShell title="G3 Nested Dialog" onClose={()=>setNested(false)}><input id="g3-nested-field" aria-label="Nested field"/><button id="g3-nested-last">Nested last</button></ModalShell>}
  </ModalShell>}
  </>}
 const root=document.createElement('div');root.id='g3-react-fixture';document.body.appendChild(root);
 createRoot(root).render(<Demo/>);`;
 const output=await build({stdin:{contents:source,loader:'tsx',resolveDir:process.cwd(),sourcefile:'g3-fixture.tsx'},bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'}});
 scriptSource=output.outputFiles[0].text;
 return scriptSource;
}

test('G3 modal shell traps keyboard focus, handles Escape LIFO, restores opener, and unlocks body',async({page})=>{
 await page.goto('/',{waitUntil:'domcontentloaded'});
 await page.addScriptTag({content:await fixture()});
 const opener=page.locator('#g3-open');
 await expect(opener).toBeVisible();
 await opener.focus();await opener.click();
 const main=page.getByRole('dialog',{name:'G3 Main Dialog'});
 await expect(main).toBeVisible();
 await expect(main.getByRole('button',{name:'Tutup dialog'})).toBeFocused();
 await expect.poll(()=>page.evaluate(()=>document.body.style.overflow)).toBe('hidden');
 await page.keyboard.press('Shift+Tab');
 await expect(page.locator('#g3-last')).toBeFocused();
 await page.keyboard.press('Tab');
 await expect(main.getByRole('button',{name:'Tutup dialog'})).toBeFocused();
 await page.locator('#g3-child').click();
 const nested=page.getByRole('dialog',{name:'G3 Nested Dialog'});
 await expect(nested).toBeVisible();
 await expect(nested.getByRole('button',{name:'Tutup dialog'})).toBeFocused();
 await page.keyboard.press('Escape');
 await expect(nested).toHaveCount(0);
 await expect(main).toBeVisible();
 await expect(page.locator('#g3-child')).toBeFocused();
 await page.keyboard.press('Escape');
 await expect(main).toHaveCount(0);
 await expect(opener).toBeFocused();
 await expect.poll(()=>page.evaluate(()=>document.body.style.overflow)).not.toBe('hidden');
});

async function employeeFixture(){
 const source=`import React,{useState} from 'react';import{createRoot}from'react-dom/client';
 import EmployeeProfile from './src/components/EmployeeDetailDrawer.tsx';
 const employee={id:'SYNTHETIC-EMPLOYEE',name:'Synthetic Employee',employeeCode:'TEST-001',company:'Synthetic Client',position:'Staff',status:'ACTIVE',bankName:'BCA',accountNo:'1234567890'};
 function Demo(){const[open,setOpen]=useState(false);return <><button id="employee-popup-open" onClick={()=>setOpen(true)}>Open employee profile</button>{open&&<EmployeeProfile employee={employee} actor={{role:'SUPER_ADMIN',permissions:['employees:write']}} maskSensitiveData={true} onClose={()=>setOpen(false)} onSaved={async()=>setOpen(false)}/>}</>}
 const root=document.createElement('div');document.body.appendChild(root);createRoot(root).render(<Demo/>);`;
 const result=await build({stdin:{contents:source,loader:'tsx',resolveDir:process.cwd(),sourcefile:'employee-profile-fixture.tsx'},bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'}});
 return result.outputFiles[0].text;
}

test('Employee profile popup preserves edits, handles nested focus, reports save errors and stays within mobile viewport',async({page})=>{
 await page.goto('/',{waitUntil:'domcontentloaded'});
 let writes=0;let failSave=true;
 await page.route('**/api/employees',async route=>{
  const body=route.request().postDataJSON();expect(body.action).toBe('UPDATE_ADMIN');expect(body.id).toBe('SYNTHETIC-EMPLOYEE');writes++;
  await route.fulfill({status:failSave?409:200,contentType:'application/json',body:JSON.stringify(failSave?{error:'Synthetic bank update refused'}:{ok:true})});
 });
 await page.addScriptTag({content:await employeeFixture()});
 const opener=page.locator('#employee-popup-open');await opener.click();
 const profile=page.getByRole('dialog',{name:'Profil Karyawan',exact:true});await expect(profile).toBeVisible();
 await expect(profile.getByRole('button',{name:'Tutup dialog',exact:true})).toBeFocused();
 await profile.getByRole('tab',{name:'Rekening Pembayaran',exact:true}).click();
 await profile.getByRole('button',{name:'Edit rekening',exact:true}).click();
 await profile.getByLabel('Nama bank',{exact:true}).fill('BNI');
 await profile.getByRole('tab',{name:'Rekening Pembayaran',exact:true}).focus();await page.keyboard.press('ArrowRight');
 const discard=page.getByRole('dialog',{name:'Perubahan belum disimpan',exact:true});await expect(discard).toBeVisible();
 await page.keyboard.press('Escape');await expect(discard).toHaveCount(0);await expect(profile.getByLabel('Nama bank',{exact:true})).toHaveValue('BNI');
 await profile.getByRole('button',{name:'Tutup profil',exact:true}).click();await expect(discard).toBeVisible();
 await discard.getByRole('button',{name:'Lanjut edit',exact:true}).click();
 await profile.getByRole('button',{name:'Simpan perubahan',exact:true}).click();await expect(profile.getByRole('alert')).toHaveText('Synthetic bank update refused');
 await expect(profile.getByLabel('Nama bank',{exact:true})).toHaveValue('BNI');
 await page.setViewportSize({width:390,height:844});
 const bounds=await profile.boundingBox();expect(bounds.x).toBeGreaterThanOrEqual(0);expect(bounds.x+bounds.width).toBeLessThanOrEqual(391);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
 failSave=false;await profile.getByRole('button',{name:'Simpan perubahan',exact:true}).click();await expect(profile).toHaveCount(0);expect(writes).toBe(2);await expect(opener).toBeFocused();
 await opener.click();await profile.getByRole('tab',{name:'Rekening Pembayaran',exact:true}).click();await profile.getByRole('button',{name:'Edit rekening',exact:true}).click();await profile.getByLabel('Nama bank',{exact:true}).fill('BNI');
 await profile.getByRole('tab',{name:'Identitas & Penempatan',exact:true}).click();await discard.getByRole('button',{name:'Buang perubahan',exact:true}).click();await expect(profile.getByRole('tab',{name:'Identitas & Penempatan',exact:true})).toHaveAttribute('aria-selected','true');
 await page.keyboard.press('Escape');await expect(profile).toHaveCount(0);await expect(opener).toBeFocused();
 await opener.click();await profile.getByRole('tab',{name:'Rekening Pembayaran',exact:true}).click();await profile.getByRole('button',{name:'Edit rekening',exact:true}).click();await profile.getByLabel('Nama bank',{exact:true}).fill('BNI');await profile.getByRole('button',{name:'Tutup profil',exact:true}).click();await discard.getByRole('button',{name:'Buang perubahan',exact:true}).click();await expect(profile).toHaveCount(0);await expect(opener).toBeFocused();
 await expect.poll(()=>page.evaluate(()=>document.body.style.overflow)).not.toBe('hidden');
});

async function supportJsonFixture(){
 const source=`import React from 'react';import{createRoot}from'react-dom/client';
 import E2PaySupportJson from './src/components/E2PaySupportJson.tsx';
 const root=document.createElement('div');root.id='support-json-fixture';document.body.appendChild(root);
 createRoot(root).render(<E2PaySupportJson requestId="DR-SUPPORT-TEST"/>);`;
 const output=await build({stdin:{contents:source,loader:'tsx',resolveDir:process.cwd(),sourcefile:'support-json-fixture.tsx'},bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'}});
 return output.outputFiles[0].text;
}

test('support JSON loads stored provider evidence, copies and downloads the same JSON without financial writes',async({page,context})=>{
 await context.grantPermissions(['clipboard-read','clipboard-write']);
 let reads=0;
 const writes=[];
 await page.route('**/api/disbursement-requests?*',async route=>{
  if(route.request().method()!=='GET'){writes.push(route.request().method());return route.abort();}
  reads++;
  await route.fulfill({json:{ok:true,request:{id:'DR-SUPPORT-TEST',clientReference:'PQP-DR-SUPPORT-TEST',provider:'E2PAY',environment:'UAT',sourceDocumentType:'PAYMENT_INSTRUCTION',sourceDocumentId:'PI-SUPPORT-TEST',status:'RECONCILED',amount:15000,recipientCount:1}}});
 });
 await page.route('**/api/disbursement-executions?*',async route=>{
  if(route.request().method()!=='GET'){writes.push(route.request().method());return route.abort();}
  reads++;
  await route.fulfill({json:{ok:true,execution:{id:'DX-SUPPORT-TEST',disbursement_request_id:'DR-SUPPORT-TEST',status:'SUCCEEDED',currency:'IDR',execution_lock_token:'SECRET-LOCK'},items:[{disbursement_execution_id:'DX-SUPPORT-TEST',client_ref:'REF-SUPPORT-TEST',amount:15000,fee_amount:2500,status:'SUCCEEDED',response_code:'00',response_message:'Success',journal_id:'JOURNAL-SUPPORT-TEST',account_last4:'1234',requestDiagnostics:{password:'SECRET-PASSWORD'}}]}});
 });
 await page.goto('/',{waitUntil:'domcontentloaded'});
 await page.addScriptTag({content:await supportJsonFixture()});
 const panel=page.getByRole('region',{name:'JSON untuk E2Pay'});
 await panel.getByRole('button',{name:'Lihat JSON',exact:true}).click();
 const output=panel.getByRole('textbox',{name:'JSON hasil transaksi E2Pay'});
 await expect(output).toBeVisible();
 const json=await output.inputValue();
 const evidence=JSON.parse(json);
 expect(evidence.recipients[0].journalId).toBe('JOURNAL-SUPPORT-TEST');
 expect(evidence.summary.succeeded).toBe(1);
 expect(evidence.environment).toBe('UAT');
 expect(json).not.toContain('SECRET-');
 await panel.getByRole('button',{name:'Salin JSON',exact:true}).click();
 await expect(panel.getByRole('status')).toHaveText('JSON berhasil disalin.');
 expect(await page.evaluate(()=>navigator.clipboard.readText())).toBe(json);
 const downloadPromise=page.waitForEvent('download');
 await panel.getByRole('button',{name:'Unduh JSON',exact:true}).click();
 const download=await downloadPromise;
 expect(download.suggestedFilename()).toBe('PQP-DR-SUPPORT-TEST-e2pay.json');
 const stream=await download.createReadStream();
 const chunks=[];for await(const chunk of stream)chunks.push(chunk);
 expect(Buffer.concat(chunks).toString('utf8')).toBe(json);
 expect(reads).toBe(2);expect(writes).toEqual([]);
});

test('support JSON handles missing execution and retries instead of exporting an empty success',async({page})=>{
 let available=false;
 await page.route('**/api/disbursement-requests?*',route=>route.fulfill({json:{request:{id:'DR-SUPPORT-TEST',clientReference:'PQP-DR-SUPPORT-TEST'}}}));
 await page.route('**/api/disbursement-executions?*',route=>available
  ?route.fulfill({json:{execution:{id:'DX-SUPPORT-TEST',disbursement_request_id:'DR-SUPPORT-TEST',status:'PROCESSING'},items:[]}})
  :route.fulfill({status:404,json:{error:'Execution ledger belum tersedia'}}));
 await page.goto('/',{waitUntil:'domcontentloaded'});
 await page.addScriptTag({content:await supportJsonFixture()});
 const panel=page.getByRole('region',{name:'JSON untuk E2Pay'});
 await panel.getByRole('button',{name:'Lihat JSON',exact:true}).click();
 await expect(panel.getByRole('alert')).toContainText('Belum ada ledger');
 await expect(panel.getByRole('button',{name:'Unduh JSON',exact:true})).toBeDisabled();
 available=true;
 await panel.getByRole('button',{name:'Coba lagi',exact:true}).click();
 const output=panel.getByRole('textbox',{name:'JSON hasil transaksi E2Pay'});
 await expect(output).toBeVisible();
 expect(JSON.parse(await output.inputValue()).execution.status).toBe('PROCESSING');
});

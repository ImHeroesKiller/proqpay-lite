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

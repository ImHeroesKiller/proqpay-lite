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

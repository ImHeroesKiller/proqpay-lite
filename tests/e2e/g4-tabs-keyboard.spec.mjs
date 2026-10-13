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

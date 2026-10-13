import{test,expect}from'@playwright/test';
import{fileURLToPath}from'node:url';

// Test-only axe injection; app production CSP and theme preferences unchanged.
test.use({bypassCSP:true});
const axePath=fileURLToPath(new URL('../../node_modules/axe-core/axe.min.js',import.meta.url));
const views=['dashboard','clients','payments','billing','reports','integrations'];
for(const theme of ['theme-dark','theme-contrast'])for(const width of [1440,390]){
 test(`G4 ${theme} desktop/mobile contrast matrix ${width}px`,async({page})=>{
  test.setTimeout(90_000);
  await page.setViewportSize({width,height:width===1440?900:844});
  await page.emulateMedia({reducedMotion:'reduce'});
  let writes=0;
  await page.route('**/api/**',async route=>{
   const req=route.request(),path=new URL(req.url()).pathname;
   if(req.method()!=='GET'){writes++;return route.fulfill({status:405,body:'{}'});}
   if(path==='/api/integration-monitor')return route.fulfill({status:503,contentType:'application/json',body:'{"error":"READ_ONLY_UAT"}'});
   const body=path==='/api/me'
    ?{authenticated:true,authMode:'session',user:{id:'G4-THEME',orgId:'G4-UAT',name:'G4 Theme',email:'g4@example.test',role:'SUPER_ADMIN',permissions:[]}}
    :{ok:true,periods:['2026-09'],submissions:[],paymentInstructions:[],paymentProofs:[],reconciliations:[],exceptions:[],records:[],requests:[],funding:[],clients:[],projects:[],employees:[],arItems:[],invoices:[],billablePayments:[],servicePlans:[],issuerProfile:null,portfolioSummary:{clients:0}};
   return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
  });
  for(const view of views){
   await page.goto(`/?view=${view}&period=2026-09`,{waitUntil:'networkidle'});
   expect(await page.locator('.module-error-boundary').count()).toBe(0);
   await page.evaluate(theme=>{
    const shell=document.querySelector('.app-shell');
    shell.classList.remove('theme-light','theme-dark','theme-contrast');shell.classList.add(theme);
   },theme);
   // Allow CSS theme transitions to settle before measuring AA contrast.
   await page.waitForTimeout(350);
   await page.addScriptTag({path:axePath});
   const result=await page.evaluate(async()=>{
    const report=await window.axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa','best-practice']}});
    return report.violations.map(v=>({id:v.id,count:v.nodes.length,targets:v.nodes.slice(0,3).map(n=>n.target.join(' '))}));
   });
   expect(result,`${view} ${theme} ${width}px`).toEqual([]);
   expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(2);
  }
  expect(writes).toBe(0);
 });
}

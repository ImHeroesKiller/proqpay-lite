import {test,expect} from '@playwright/test';
import {fileURLToPath} from 'node:url';

// Read-only synthetic identities; every financial POST/PATCH/DELETE is rejected.
// CSP bypass is strictly test-only to inject axe: deployment CSP is tested
// separately by the production security smoke and is never modified here.
test.use({bypassCSP:true});
const axePath=fileURLToPath(new URL('../../node_modules/axe-core/axe.min.js',import.meta.url));
const roleViews={
 SUPER_ADMIN:['dashboard','clients','operations','exceptions','payments','billing','employees','reports','integrations','ewa','logs','portalSettings'],
 PAYROLL_PROCESSOR:['dashboard','clients','operations','exceptions','payments','billing'],
 PAYROLL_CONTROLLER:['dashboard','operations','exceptions','payments','billing'],
 CLIENT_USER:['dashboard','operations','reports'],
};
const viewports=[{width:1440,height:900},{width:390,height:844},{width:320,height:720}];

for(const viewport of viewports){
 for(const [role,views] of Object.entries(roleViews)){
  if(viewport.width===320&&role!=='SUPER_ADMIN')continue;
  test(`G4 axe WCAG/contrast and responsive role matrix: ${role} / ${viewport.width}px`,async({page})=>{
   test.setTimeout(120_000);
   await page.setViewportSize(viewport);
   let writes=0;let pageErrors=[];
   page.on('pageerror',e=>pageErrors.push(e.message));
   await page.route('**/api/**',async route=>{
    const req=route.request(),path=new URL(req.url()).pathname;
    if(req.method()!=='GET'){
     writes++;
     return route.fulfill({status:405,contentType:'application/json',body:'{"error":"G4_READ_ONLY"}'});
    }
    if(path==='/api/integration-monitor')return route.fulfill({status:503,contentType:'application/json',body:'{"error":"G4_READONLY_PROVIDER_UNAVAILABLE"}'});
    const body=path==='/api/me'
     ?{authenticated:true,authMode:'session',user:{id:'G4-ROLE-UAT',orgId:'G4-UAT',name:'G4 Accessibility',email:'g4@example.test',role,permissions:[],clientIds:[],projectIds:[]}}
     :{ok:true,periods:['2026-09'],submissions:[],paymentInstructions:[],paymentProofs:[],reconciliations:[],exceptions:[],requests:[],funding:[],records:[],clients:[],projects:[],employees:[],servicePlans:[],arItems:[],invoices:[],billablePayments:[],issuerProfile:null,portfolioSummary:{clients:0}};
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
   });
   for(const view of views){
    pageErrors=[];
    const response=await page.goto(`/?view=${view}&period=2026-09`,{waitUntil:'networkidle'});
    expect(response?.status(),`${role} ${view} status`).toBe(200);
    expect(await page.locator('.module-error-boundary').count(),`${role} ${view} must not show a crashed module`).toBe(0);
    await page.addScriptTag({path:axePath});
    const result=await page.evaluate(async()=>{
     const report=await window.axe.run(document,{
      runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa','best-practice']},
     });
     return {
      violations:report.violations.map(v=>({id:v.id,impact:v.impact,count:v.nodes.length,targets:v.nodes.slice(0,3).map(n=>n.target.join(' '))})),
      overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth,
      headingCount:document.querySelectorAll('h1').length,
      mainCount:document.querySelectorAll('main').length,
     };
    });
    expect(result.violations,`${role} ${view} ${viewport.width}px accessibility`).toEqual([]);
    expect(result.overflow,`${role} ${view} ${viewport.width}px horizontal overflow`).toBeLessThanOrEqual(2);
    expect(result.headingCount,`${role} ${view} ${viewport.width}px needs a level-1 heading`).toBeGreaterThanOrEqual(1);
    expect(result.mainCount).toBeGreaterThanOrEqual(1);
    expect(pageErrors,`${role} ${view} runtime errors`).toEqual([]);
   }
   expect(writes,'UAT never calls financial mutations').toBe(0);
  });
 }
}

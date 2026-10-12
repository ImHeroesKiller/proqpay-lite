import { test, expect } from '@playwright/test';

const SAFE_PATHS=[
 '/api/me', '/api/operating-model', '/api/disbursement-requests',
 '/api/disbursement-executions', '/api/e2pay-disbursement-limits',
 '/api/provider-channel-mappings', '/api/canonical-transaction-register',
 '/api/client-bank-beneficiaries?clientId=P2-NOT-REAL',
];

test.describe('P2 production public/unauthenticated safety & visual',()=>{
 test('reviewed release, health, headers, and non-authenticated data isolation',async({request,baseURL})=>{
   const release=await request.get(`${baseURL}/release.json`);
   expect(release.ok()).toBeTruthy();
   expect((await release.json()).commit).toMatch(/^[a-f0-9]{40}$/);
   const health=await request.get(`${baseURL}/api/health`);
   expect(health.status()).toBe(200);
   const body=await health.json();
   expect(body.ready).toBe(true);
   expect(body.database).toBe('d1');
   expect(body.auth_mode).toBe('session');
   expect((body.checks||[]).filter(check=>check.status==='error')).toHaveLength(0);
   const response=await request.get(`${baseURL}/`);
   expect(response.ok()).toBeTruthy();
   expect(response.headers()['content-security-policy']).toContain("frame-ancestors 'none'");
   expect(response.headers()['strict-transport-security']).toBeTruthy();
   for(const path of SAFE_PATHS){
     const result=await request.get(`${baseURL}${path}`);
     expect([401,403],`Read-only ${path} must require a real session`).toContain(result.status());
   }
 });

 for(const viewport of [{width:1440,height:900},{width:390,height:844},{width:320,height:720}]){
   test(`anonymous shell ${viewport.width}x${viewport.height} has no layout overflow or runtime errors`,async({page})=>{
     const errors=[];page.on('pageerror',error=>errors.push(error.message));
     await page.setViewportSize(viewport);
     const result=await page.goto('/?view=payments&stage=payment&paymentPanel=DISBURSEMENT',{waitUntil:'networkidle'});
     expect(result?.status()).toBe(200);
     await expect(page.locator('form.login-form')).toBeVisible();
     const metrics=await page.evaluate(()=>({
       overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth,
       loginWidth:document.querySelector('form.login-form')?.getBoundingClientRect().width||0,
       viewport:innerWidth,
     }));
     expect(metrics.overflow,'Anonymous shell may not overflow the viewport').toBeLessThanOrEqual(2);
     expect(metrics.loginWidth).toBeGreaterThan(150);
     expect(metrics.loginWidth).toBeLessThanOrEqual(metrics.viewport);
     expect(errors).toEqual([]);
     await page.screenshot({path:`artifacts/p2-public-${viewport.width}.png`,fullPage:true});
   });
 }
});

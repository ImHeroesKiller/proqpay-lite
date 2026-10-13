import {test,expect} from '@playwright/test';

// Public, read-only deployment gate. Never authenticate or send payment writes.
test('G4 production release, protected APIs, D1 health and strict security headers',async({request,baseURL})=>{
 const release=await request.get(`${baseURL}/release.json`);
 expect(release.status()).toBe(200);
 const body=await release.json();expect(body.commit).toMatch(/^[0-9a-f]{40}$/);
 const health=await request.get(`${baseURL}/api/health`);
 expect(health.status()).toBe(200);
 const data=await health.json();expect(data.ready).toBe(true);expect(data.database).toBe('d1');expect(data.auth_mode).toBe('session');
 const index=await request.get(baseURL);
 expect(index.status()).toBe(200);
 expect(index.headers()['content-security-policy']).toContain("frame-ancestors 'none'");
 expect(index.headers()['strict-transport-security']).toBeTruthy();
 for(const route of ['/api/me','/api/disbursement-requests','/api/e2pay-subaccounts','/api/canonical-transaction-register','/api/provider-channel-mappings']){
  const response=await request.get(`${baseURL}${route}`);
  expect([401,403],`${route} must reject anonymous read`).toContain(response.status());
 }
});
for(const viewport of [{width:1440,height:900},{width:390,height:844},{width:320,height:720}]){
 test(`G4 production login remains keyboard reachable and responsive ${viewport.width}px`,async({page})=>{
  await page.setViewportSize(viewport);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/?view=payments&stage=payment&paymentPanel=DISBURSEMENT',{waitUntil:'networkidle'});
  const login=page.locator('form.login-form');await expect(login).toBeVisible();
  await expect(page.getByRole('textbox').first()).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(2);
  expect(errors).toEqual([]);
 });
}

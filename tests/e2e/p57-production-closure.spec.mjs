import { test, expect } from '@playwright/test';

const protectedPaths=[
  '/api/me',
  '/api/operating-model',
  '/api/e2pay-disbursement-limits',
  '/api/disbursement-requests',
  '/api/disbursement-executions',
  '/api/canonical-transaction-register',
  '/api/legacy-compatibility',
  '/api/client-bank-beneficiaries?clientId=UAT-CLOSURE-NOOP',
];

test.describe('P5.7.10 production closure smoke',()=>{
  test('production shell, release, health and edge security are converged',async({page,request,baseURL})=>{
    const response=await page.goto('/',{waitUntil:'networkidle'});
    expect(response?.ok()).toBeTruthy();
    await expect(page.locator('body')).toContainText(/ProQPay/i);
    const health=await request.get(`${baseURL}/api/health`);
    expect(health.status()).toBe(200);
    const body=await health.json();
    expect(body.ready).toBe(true);
    expect(body.database).toBe('d1');
    expect(body.auth_mode).toBe('session');
    expect((body.checks||[]).some(x=>x.status==='error')).toBe(false);
    const release=await request.get(`${baseURL}/release.json`);
    expect(release.status()).toBe(200);
    expect(String((await release.json()).commit||'').length).toBeGreaterThan(20);
    const headers=response?.headers()||{};
    expect(headers['strict-transport-security']).toBeTruthy();
    expect(headers['cross-origin-opener-policy']).toBe('same-origin');
    expect(headers['cross-origin-resource-policy']).toBe('same-origin');
    expect(headers['x-content-type-options']).toBe('nosniff');
    const csp=headers['content-security-policy']||'';
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
  });

  test('all P5.7 financial/governance APIs fail closed anonymously',async({request,baseURL})=>{
    for(const path of protectedPaths){
      const response=await request.get(`${baseURL}${path}`);
      expect([401,403],`${path} must reject anonymous access`).toContain(response.status());
    }
  });

  test('public shell remains responsive without console/page errors',async({page})=>{
    const pageErrors=[]; const consoleErrors=[];
    page.on('pageerror',err=>pageErrors.push(err.message));
    page.on('console',msg=>{if(msg.type()==='error'&&!/cloudflareinsights/i.test(msg.text())) consoleErrors.push(msg.text());});
    await page.setViewportSize({width:390,height:844});
    await page.goto('/',{waitUntil:'domcontentloaded'});
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(2);
    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });
});

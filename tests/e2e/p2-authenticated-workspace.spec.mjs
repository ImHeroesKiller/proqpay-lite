import {test,expect} from '@playwright/test';

// Security invariant: this suite is read-only. Never POST to financial APIs,
// run a disbursement, alter credentials, enroll MFA or reset a passkey.
const EMAIL=process.env.PROQPAY_UAT_EMAIL||'';
const PASSWORD=process.env.PROQPAY_UAT_PASSWORD||'';
const APPROVED_ROLES=new Set(['SUPER_ADMIN','PAYROLL_PROCESSOR','PAYROLL_CONTROLLER']);

async function visualEvidence(page,label){
 const info=await page.evaluate(()=>({
   viewport:innerWidth,
   overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth,
   heading:[...document.querySelectorAll('h1,h2')].filter(el=>el.getBoundingClientRect().width>0).map(el=>el.textContent?.trim()).slice(0,5),
   errorRegions:document.querySelectorAll('[role="alert"]').length,
 }));
 expect(info.overflow,`${label} (${info.viewport}px) horizontal overflow`).toBeLessThanOrEqual(2);
 expect(info.heading.length,`${label} must have a visible heading`).toBeGreaterThan(0);
 return info;
}

// One login attempt only. A bad/stale credential should never cause a lockout
// because of retries. The response is recorded by status and code only.
test('P2 authenticated role-specific workflow, read-only DR/funding/register, desktop and mobile',async({page},testInfo)=>{
 test.setTimeout(180_000);
 expect(EMAIL.length,'PROQPAY_UAT_EMAIL not configured').toBeGreaterThan(0);
 expect(PASSWORD.length,'PROQPAY_UAT_PASSWORD not configured').toBeGreaterThan(0);
 const response=await page.goto('/',{waitUntil:'domcontentloaded'});
 expect(response?.status()).toBe(200);
 const callback=page.waitForResponse(res=>res.url().includes('/api/login')&&res.request().method()==='POST',{timeout:45000});
 await page.getByPlaceholder('nama@perusahaan.com').fill(EMAIL);
 await page.getByPlaceholder('Masukkan password').fill(PASSWORD);
 const started=Date.now();
 await page.locator('form.login-form button.login-submit').click();
 let auth;
 try{auth=await callback;}catch{
   throw new Error('P2_AUTH_LOGIN_TIMEOUT: /api/login did not answer within 45s; do not retry or bypass MFA.');
 }
 const elapsedMs=Date.now()-started;
 const payload=await auth.json().catch(()=>({}));
 const authCode=String(payload.code||'NONE');
 // No personal names, password, MFA secrets, challenges or response body in logs.
 console.log(`P2_AUTH_HANDSHAKE status=${auth.status()} code=${authCode} latency_ms=${elapsedMs}`);
 if(auth.status()===428){
   throw new Error(`P2_BLOCKED_STRONG_AUTH: login requires ${authCode}. Complete MFA/passkey interactively; do not bypass or reset security.`);
 }
 if(auth.status()!==200){
   throw new Error(`P2_BLOCKED_AUTH: login returned HTTP ${auth.status()} / ${authCode}; verify authorized UAT credentials and account status before retrying.`);
 }
 await page.reload({waitUntil:'domcontentloaded'});
 await expect(page.locator('aside.app-sidebar')).toBeVisible({timeout:20000});
 const me=await page.request.get('/api/me');
 expect(me.status()).toBe(200);
 const meData=await me.json();
 const role=meData.user?.role;
 expect(APPROVED_ROLES.has(role),`P2_ROLE_COVERAGE: UAT role ${role} cannot test privileged workflow`).toBe(true);
 const allTabs=[];
 const pageErrors=[];
 page.on('pageerror',error=>pageErrors.push(error.message));
 for(const viewport of [{width:1440,height:900},{width:390,height:844}]){
  await page.setViewportSize(viewport);
  const views=[
    ['payment PI','/?view=payments&stage=payment&paymentPanel=PI','Unified Payment Workbench'],
    ['canonical DR','/?view=payments&stage=payment&paymentPanel=DISBURSEMENT','Canonical Disbursement Control'],
    ['funding','/?view=payments&stage=payment&paymentPanel=FUNDING','Funding & Liquidity Summary'],
    ['reconciliation','/?view=billing&stage=close','Canonical Transaction Register'],
    ['EWA','/?view=ewa','main'],
  ];
  for(const [label,path,selector] of views){
    const response=await page.goto(path,{waitUntil:'domcontentloaded'});
    expect(response?.status()).toBe(200);
    await expect(page.locator('aside.app-sidebar')).toBeVisible({timeout:15000});
    const locator=label==='payment PI'?page.getByRole('region',{name:'Unified Payment Workbench'})
      :label==='canonical DR'?page.getByRole('region',{name:'Canonical Disbursement Control'})
      :label==='funding'?page.getByRole('region',{name:'Funding & Liquidity Summary'})
      :label==='reconciliation'?page.getByText('Disbursement Transaction Register',{exact:true})
      :page.locator('main').first();
    await expect(locator,`${label} must render at ${viewport.width}px`).toBeVisible({timeout:15000});
    allTabs.push({label,viewport:viewport.width,...await visualEvidence(page,label)});
  }
 }
 // Read-only API contracts. No CREATE/SUBMIT/APPROVE/EXECUTE/RECONCILE.
 for(const endpoint of ['/api/disbursement-requests','/api/provider-channel-mappings','/api/e2pay-disbursement-limits','/api/canonical-transaction-register?page=1&pageSize=40']){
   const result=await page.request.get(endpoint);
   expect(result.status(),`P2 authenticated read-only ${endpoint}`).toBe(200);
 }
 expect(pageErrors).toEqual([]);
 await testInfo.attach('read-only-role-visual-metrics',{body:JSON.stringify({role,views:allTabs}),contentType:'application/json'});
});

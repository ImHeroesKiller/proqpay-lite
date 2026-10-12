import{test,expect}from'@playwright/test';

// G1 CSS regression is anonymous/read-only. The /api/me probe is mocked to
// suppress MFA prompts; no credentials, banking, or financial requests issued.
test('G1 design foundation preserves desktop/mobile login and compact payment/master styling',async({page})=>{
 for(const viewport of [{width:1440,height:900},{width:390,height:844}]){
  await page.setViewportSize(viewport);
  await page.route(/\/api\/me(?:\?|$)/,route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({authenticated:false,user:null,authMode:'session'})}));
  const response=await page.goto('/',{waitUntil:'networkidle'});
  expect(response?.status()).toBe(200);
  await expect(page.locator('.login-shell')).toBeVisible();
  const sizes=await page.locator('.login-shell').evaluate(el=>{const r=el.getBoundingClientRect();return{width:Math.round(r.width),height:Math.round(r.height)}});
  expect(sizes.width).toBe(viewport.width===1440?1180:390);
  expect(sizes.height).toBe(viewport.width===1440?720:844);
  expect(await page.locator('.login-story').evaluate(el=>getComputedStyle(el).display)).toBe(viewport.width===1440?'block':'none');
  const token=await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--accent').trim());
  expect(token).toBe('#f05a16');
  await page.evaluate(()=>{
   const el=document.createElement('div');el.id='g1-visual-fixture';
   el.style.cssText='position:absolute;top:1100px;left:0;width:min(800px,100%);';
   el.innerHTML=`<div class="directory-workspace"><div class="directory-inline-stats"><span><strong>2</strong>klien</span></div><div class="directory-filter-compact"><div class="ui-filter-grid"><label><span>Cari</span><input aria-label="G1 Filter Sample"></label><label><span>Status</span><select><option>Semua</option></select></label></div></div><section class="directory-master-flat"><div class="directory-entity-card"><div class="directory-entity-main"><b>Sample Client</b></div></div></section></div><div class="payroll-stage-nav payroll-stage-nav-compact"><button class="active"><b>1</b>Payment</button></div><div class="payroll-shared-filter payroll-shared-filter-payments"><label><span>Period</span><select><option>2026-09</option></select></label></div><nav class="payment-decision-nav payment-decision-nav-compact"><button class="active"><strong>PI</strong><small>Queue</small></button></nav>`;
   document.body.appendChild(el);
  });
  expect(await page.locator('.directory-filter-compact input').evaluate(el=>Math.round(el.getBoundingClientRect().height))).toBe(32);
  expect(await page.locator('.directory-master-flat').evaluate(el=>getComputedStyle(el).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
  expect(await page.locator('.directory-entity-card').evaluate(el=>getComputedStyle(el).borderTopWidth)).toBe('0px');
  expect(await page.locator('.payroll-shared-filter-payments').evaluate(el=>getComputedStyle(el).position)).toBe('static');
  expect(await page.locator('.payment-decision-nav-compact button').evaluate(el=>Math.round(el.getBoundingClientRect().height))).toBe(viewport.width===1440?38:40);
  expect(await page.locator('.payroll-stage-nav-compact').evaluate(el=>getComputedStyle(el).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
  // Do not count the intentionally synthetic fixture against horizontal overflow.
  await page.evaluate(()=>document.getElementById('g1-visual-fixture')?.remove());
 }
});

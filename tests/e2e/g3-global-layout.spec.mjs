import{test,expect}from'@playwright/test';

// GET-only synthetic fixtures. This is not an authenticated production UAT and
// never supplies merchant credentials, initiates payments, approves PI or writes D1.
async function mockActor(page,role){
 const totals={posts:0};
 await page.route('**/api/**',async route=>{
  const req=route.request();const path=new URL(req.url()).pathname;
  if(req.method()!=='GET'){
   totals.posts++;return route.fulfill({status:405,contentType:'application/json',body:'{"error":"G3_READ_ONLY"}'});
  }
  const body=path==='/api/me'
   ?{authenticated:true,authMode:'session',user:{id:'G3-'+role,orgId:'G3-ORG',name:'G3 UAT',email:'g3@example.test',role,permissions:[],clientIds:[],projectIds:[]}}
   :{ok:true,periods:['2026-09'],submissions:[],paymentInstructions:[],paymentProofs:[],reconciliations:[],exceptions:[],requests:[],funding:[],records:[],clients:[],projects:[],employees:[],servicePlans:[],arItems:[],invoices:[],billablePayments:[],issuerProfile:null,portfolioSummary:{clients:0}};
  return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
 });
 return totals;
}

for(const width of [1440,390]){
 test(`G3 flat master and payment workspaces retain layout semantics at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:width===390?844:900});
  const state=await mockActor(page,'SUPER_ADMIN');const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/?view=clients&period=2026-09',{waitUntil:'networkidle'});
  await expect(page.locator('.directory-header h2')).toHaveText('Klien & Project');
  await expect(page.locator('.directory-filter-compact')).toHaveAttribute('role','search');
  expect(await page.locator('.directory-inline-stats > span').count()).toBe(4);
  expect(await page.locator('.directory-inline-stats .card').count()).toBe(0);
  expect(await page.locator('.directory-filter-compact input').evaluate(el=>Math.round(el.getBoundingClientRect().height))).toBe(32);
  await page.goto('/?view=payments&period=2026-09',{waitUntil:'networkidle'});
  await expect(page.locator('.payment-decision-inline')).toBeVisible();
  expect(await page.locator('.payment-decision-inline > div').count()).toBe(4);
  expect(await page.locator('.payment-decision-inline .card').count()).toBe(0);
  expect(await page.locator('.operations-control-bar-payments')).toHaveCount(1);
  const scroll=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,screen:document.documentElement.clientWidth}));
  expect(scroll.scroll).toBeLessThanOrEqual(scroll.screen+1);
  expect(errors).toEqual([]);expect(state.posts).toBe(0);
 });
}

test('G3 privileged and client views preserve canonical role-oriented workspaces',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 for(const role of ['PAYROLL_PROCESSOR','PAYROLL_CONTROLLER']){
  await page.unrouteAll();const state=await mockActor(page,role);
  await page.goto('/?view=payments&stage=payment&period=2026-09',{waitUntil:'networkidle'});
  await expect(page.locator('.unified-payroll-workspace')).toBeVisible();
  await expect(page.getByRole('button',{name:/Approval & Payment/})).toHaveClass(/active/);
  await expect(page.locator('.payroll-shared-filter-payments')).toBeVisible();
  expect(await page.locator('.payment-decision-inline .card').count()).toBe(0);
  expect(state.posts).toBe(0);
 }
 await page.unrouteAll();const state=await mockActor(page,'CLIENT_USER');
 await page.goto('/?view=payments&period=2026-09',{waitUntil:'networkidle'});
 expect(new URL(page.url()).searchParams.get('view')).toBe('operations');
 await expect(page.locator('.unified-payroll-workspace')).toHaveCount(0);
 expect(state.posts).toBe(0);expect(errors).toEqual([]);
});

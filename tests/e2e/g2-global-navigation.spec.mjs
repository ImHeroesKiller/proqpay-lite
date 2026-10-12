import{test,expect}from'@playwright/test';

// Isolated browser UAT with fake identity and read-only API fixtures. No real
// login, provider calls, MFA bypass, payment execution or production writes.
test('G2 internal payroll stage navigation owns URL once and survives Back/Forward',async({page})=>{
 await page.setViewportSize({width:1440,height:900});
 let mutations=0;
 await page.route('**/api/**',async route=>{
  const request=route.request();
  if(request.method()!=='GET'){
   mutations++;return route.fulfill({status:405,contentType:'application/json',body:'{"error":"READ_ONLY_G2_UAT"}'});
  }
  const path=new URL(request.url()).pathname;
  const body=path==='/api/me'
   ?{authenticated:true,authMode:'session',user:{id:'G2-UAT',orgId:'ORG-G2',name:'G2 Test',email:'g2@example.test',role:'PAYROLL_PROCESSOR',permissions:[]}}
   :{ok:true,periods:['2026-09'],submissions:[],paymentInstructions:[],paymentProofs:[],reconciliations:[],exceptions:[],requests:[],funding:[],records:[],clients:[],projects:[],employees:[],servicePlans:[],portfolioSummary:{clients:0}};
  await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
 });
 const pageErrors=[];page.on('pageerror',err=>pageErrors.push(err.message));
 await page.goto('/?view=payments&stage=payment&period=2026-09&paymentPanel=FUNDING&fundingAccountId=G2-REG-0190',{waitUntil:'networkidle'});
 await expect(page.locator('.unified-payroll-workspace')).toBeVisible();
 await expect(page.getByRole('button',{name:/Approval & Payment/})).toHaveClass(/active/);
 expect(new URL(page.url()).searchParams.get('fundingAccountId')).toBe('G2-REG-0190');
 await page.getByRole('button',{name:/Data & Payroll/}).click();
 let params=new URL(page.url()).searchParams;
 expect(params.get('view')).toBe('operations');expect(params.get('stage')).toBe('payroll');
 expect(params.get('period')).toBe('2026-09');expect(params.get('paymentPanel')).toBe(null);
 await page.getByRole('button',{name:/Approval & Payment/}).click();
 params=new URL(page.url()).searchParams;
 expect(params.get('view')).toBe('payments');expect(params.get('stage')).toBe('payment');
 await page.goBack();await expect(page.getByRole('button',{name:/Data & Payroll/})).toHaveClass(/active/);
 params=new URL(page.url()).searchParams;
 expect(params.get('stage')).toBe('payroll');expect(params.get('period')).toBe('2026-09');
 await page.goBack();await expect(page.getByRole('button',{name:/Approval & Payment/})).toHaveClass(/active/);
 expect(new URL(page.url()).searchParams.get('paymentPanel')).toBe('FUNDING');
 await page.goForward();await expect(page.getByRole('button',{name:/Data & Payroll/})).toHaveClass(/active/);
 expect(mutations).toBe(0);
 expect(pageErrors).toEqual([]);
});

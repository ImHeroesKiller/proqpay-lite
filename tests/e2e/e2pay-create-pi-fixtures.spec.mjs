import { test, expect } from '@playwright/test';

const email=process.env.PROQPAY_UAT_EMAIL||'';
const password=process.env.PROQPAY_UAT_PASSWORD||'';
const hasCredentials=Boolean(email&&password);

async function login(page){
  await page.goto('/',{waitUntil:'domcontentloaded'});
  if(await page.locator('aside.app-sidebar').isVisible().catch(()=>false)) return;
  test.skip(!hasCredentials,'UAT credentials are required');
  const status=await page.evaluate(async({email,password})=>{
    const response=await fetch('/api/login',{
      method:'POST',
      credentials:'same-origin',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({email,password}),
    }).catch(()=>null);
    return response?.status||0;
  },{email,password});
  if(status===200) await page.reload({waitUntil:'domcontentloaded'});
  else{
    await page.getByPlaceholder('nama@perusahaan.com').fill(email);
    await page.getByPlaceholder('Masukkan password').fill(password);
    await page.locator('form.login-form button.login-submit').click();
  }
  await expect(page.locator('aside.app-sidebar')).toBeVisible({timeout:15000});
}

test('create approved E2Pay UAT dummy Payment Instructions',async({page})=>{
  test.skip(!hasCredentials,'UAT credentials are required');
  await login(page);

  const result=await page.evaluate(async()=>{
    const response=await fetch('/api/e2pay-uat-fixtures',{
      method:'POST',
      credentials:'same-origin',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({confirmation:'CREATE E2PAY UAT PI'}),
    });
    return {status:response.status,body:await response.json().catch(()=>({}))};
  });

  expect(result.status).toBe(201);
  expect(result.body?.provider).toBe('E2PAY');
  expect(result.body?.environment).toBe('UAT');
  expect(result.body?.dummyDestination).toEqual({bank:'Permata',bankId:'permata',accountId:'701075327'});
  expect(result.body?.fixtures).toHaveLength(4);

  const expected=[
    ['SINGLE',1,15000],
    ['DOUBLE',2,30000],
    ['TRIPLE',3,45000],
    ['FIVE',5,75000],
  ];
  for(const [key,recipients,total] of expected){
    const item=result.body.fixtures.find((row)=>row.key===key);
    expect(item).toBeTruthy();
    expect(item.status).toBe('APPROVED_FOR_PAYMENT');
    expect(item.recipients).toBe(recipients);
    expect(item.total).toBe(total);
    expect(item.gatewayTransaction).toBeNull();
  }

  console.log('E2PAY_UAT_PI_FIXTURES='+JSON.stringify(result.body.fixtures));
});

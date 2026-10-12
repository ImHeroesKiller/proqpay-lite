import {test,expect} from '@playwright/test';

// Unauthenticated, read-only smoke test. Never submits login, OTP, payment,
// bank credentials, client data, or other financial mutations.
test('G0 removes old browser-persisted employee/payroll/IDA state on initial boot',async({page})=>{
 await page.addInitScript(()=>{
   localStorage.setItem('proqpay_db_v3',JSON.stringify({employees:[{name:'G0_SENTINEL_PRIVATE_EMPLOYEE'}],payrolls:[{status:'APPROVED'}]}));
   localStorage.setItem('proqpay_db_v2','G0_SENTINEL_OLD_PAYROLL');
   localStorage.setItem('proqpay_system_logs_v1','G0_SENTINEL_PRIVATE_LOG');
   localStorage.setItem('proqpay_ida_session','G0_SENTINEL_OLD_SESSION');
   localStorage.setItem('proqpay_settings_v3',JSON.stringify({theme:'light'}));
 });
 const response=await page.goto('/',{waitUntil:'domcontentloaded'});
 expect(response?.status()).toBe(200);
 await expect.poll(()=>page.evaluate(()=>({
   mirror:localStorage.getItem('proqpay_db_v3'),
   oldMirror:localStorage.getItem('proqpay_db_v2'),
   logs:localStorage.getItem('proqpay_system_logs_v1'),
   ida:localStorage.getItem('proqpay_ida_session'),
   preferencesTheme:JSON.parse(localStorage.getItem('proqpay_settings_v3')||'{}').theme||null,
 })),{timeout:15000}).toEqual({mirror:null,oldMirror:null,logs:null,ida:null,preferencesTheme:'light'});
 await expect(page.getByText('G0_SENTINEL_PRIVATE_EMPLOYEE')).toHaveCount(0);
});

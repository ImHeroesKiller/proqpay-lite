const baseUrl=String(process.env.BASE_URL||'https://proqpay-lite.pages.dev').replace(/\/$/,'');
const email=String(process.env.PROQPAY_UAT_EMAIL||'').trim();
const password=String(process.env.PROQPAY_UAT_PASSWORD||'');

if(!email || !password) throw new Error('PROQPAY_UAT_EMAIL/PASSWORD are required');

const response=await fetch(`${baseUrl}/api/login`,{
  method:'POST',
  headers:{'Content-Type':'application/json','Origin':baseUrl,'Sec-Fetch-Site':'same-origin'},
  body:JSON.stringify({email,password}),
});
const body=await response.json().catch(()=>({}));

if(response.status!==428){
  throw new Error(`Expected MFA enforcement challenge (HTTP 428), received HTTP ${response.status}`);
}
if(!['MFA_REQUIRED','MFA_ENROLLMENT_REQUIRED'].includes(String(body?.code||''))){
  throw new Error(`Unexpected MFA challenge code: ${String(body?.code||'NONE')}`);
}
console.log(JSON.stringify({
  ok:true,
  mfaEnforced:true,
  challenge:String(body.code),
}));

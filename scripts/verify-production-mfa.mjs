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
  throw new Error(`Expected strong-auth enforcement challenge (HTTP 428), received HTTP ${response.status}`);
}
const challenge=String(body?.code||'');
const accepted=new Set(['MFA_REQUIRED','MFA_ENROLLMENT_REQUIRED','PASSKEY_REQUIRED']);
if(!accepted.has(challenge)){
  throw new Error(`Unexpected strong-auth challenge code: ${challenge||'NONE'}`);
}
console.log(JSON.stringify({
  ok:true,
  strongAuthEnforced:true,
  mfaEnforced:challenge.startsWith('MFA_'),
  passkeyEnforced:challenge==='PASSKEY_REQUIRED',
  challenge,
}));

const baseUrl=String(process.env.BASE_URL||'https://proqpay-lite.pages.dev').replace(/\/$/,'');
const email=String(process.env.PROQPAY_UAT_EMAIL||'').trim();
const password=String(process.env.PROQPAY_UAT_PASSWORD||'');

if(!/^https:\/\//.test(baseUrl)) throw new Error('BASE_URL must use https://');
if(!email || !password) throw new Error('PROQPAY_UAT_EMAIL/PASSWORD are required');

async function parse(response){
  const body=await response.json().catch(()=>({}));
  if(!response.ok){
    const error=new Error(String(body?.error||body?.message||`HTTP ${response.status}`));
    error.status=response.status;
    error.code=body?.code||null;
    error.body=body;
    throw error;
  }
  return body;
}

const loginResponse=await fetch(`${baseUrl}/api/login`,{
  method:'POST',
  headers:{'Content-Type':'application/json','Origin':baseUrl,'Sec-Fetch-Site':'same-origin'},
  body:JSON.stringify({email,password}),
});
const loginBody=await loginResponse.clone().json().catch(()=>({}));
if(loginResponse.status===428){
  throw new Error(`Production migration credential requires MFA enrollment/verification before automation can continue (${loginBody?.code||'MFA_REQUIRED'}).`);
}
await parse(loginResponse);
const setCookie=loginResponse.headers.get('set-cookie')||'';
const sessionCookie=setCookie.split(';').find((part)=>part.trim().startsWith('proqpay_session='))?.trim();
if(!sessionCookie) throw new Error('Login succeeded but no ProQPay session cookie was returned');

async function api(path,init={}){
  const response=await fetch(`${baseUrl}${path}`,{
    ...init,
    headers:{
      'Content-Type':'application/json',
      'Origin':baseUrl,
      'Sec-Fetch-Site':'same-origin',
      'Cookie':sessionCookie,
      ...(init.headers||{}),
    },
  });
  return {response,body:await response.clone().json().catch(()=>({}))};
}

let statusResult=await api('/api/security-bank-migration');
if(!statusResult.response.ok){
  throw new Error(`Bank migration status failed: HTTP ${statusResult.response.status} ${String(statusResult.body?.error||'')}`);
}

const initial=statusResult.body?.status||{};
console.log(JSON.stringify({
  phase:'before',
  total:Number(initial.total||0),
  encrypted:Number(initial.encrypted||0),
  legacyPlaintext:Number(initial.legacyPlaintext||0),
  invalidMarkerOnly:Number(initial.invalidMarkerOnly||0),
}));

let iterations=0;
while(Number(statusResult.body?.status?.legacyPlaintext||0)>0){
  iterations+=1;
  if(iterations>100) throw new Error('Bank encryption migration exceeded 100 batches');
  const migration=await api('/api/security-bank-migration',{
    method:'POST',
    body:JSON.stringify({confirmation:'ENCRYPT LEGACY BANK ACCOUNTS'}),
  });
  if(![200,207].includes(migration.response.status)){
    throw new Error(`Bank migration batch failed: HTTP ${migration.response.status} ${String(migration.body?.error||'')}`);
  }
  if(Array.isArray(migration.body?.failed) && migration.body.failed.length){
    throw new Error(`Bank migration batch reported ${migration.body.failed.length} failed row(s); plaintext was not deleted for those rows.`);
  }
  statusResult=await api('/api/security-bank-migration');
  if(!statusResult.response.ok) throw new Error('Unable to verify bank migration progress');
  console.log(JSON.stringify({
    phase:'batch',
    batch:iterations,
    remaining:Number(statusResult.body?.status?.legacyPlaintext||0),
    encrypted:Number(statusResult.body?.status?.encrypted||0),
  }));
}

const finalStatus=statusResult.body?.status||{};
if(Number(finalStatus.legacyPlaintext||0)!==0) throw new Error('Legacy plaintext bank rows remain after migration');
if(Number(finalStatus.invalidMarkerOnly||0)!==0) throw new Error('Marker-only bank rows detected without ciphertext');

const mfa=await api('/api/security-mfa');
const mfaSummary=mfa.response.ok ? {
  required:Boolean(mfa.body?.mfa?.required),
  configured:Boolean(mfa.body?.mfa?.configured),
  active:Boolean(mfa.body?.mfa?.active),
  enforcement:String(mfa.body?.mfa?.enforcement||'UNKNOWN'),
} : {error:`HTTP ${mfa.response.status}`};

console.log(JSON.stringify({
  ok:true,
  phase:'complete',
  bankEncryption:{
    total:Number(finalStatus.total||0),
    encrypted:Number(finalStatus.encrypted||0),
    legacyPlaintext:0,
    invalidMarkerOnly:0,
    batches:iterations,
  },
  mfa:mfaSummary,
}));

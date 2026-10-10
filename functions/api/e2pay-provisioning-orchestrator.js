const UPPER='ABCDEFGHJKLMNPQRSTUVWXYZ';
const LOWER='abcdefghijkmnopqrstuvwxyz';
const DIGITS='23456789';
const SPECIAL='!@#$%';
const ALL=UPPER+LOWER+DIGITS+SPECIAL;
function pick(chars){ const b=crypto.getRandomValues(new Uint8Array(1)); return chars[b[0]%chars.length]; }
export function generateManagedMerchantPassword(){
  const values=[pick(UPPER),pick(LOWER),pick(DIGITS),pick(SPECIAL)];
  while(values.length<12) values.push(pick(ALL));
  for(let i=values.length-1;i>0;i--){ const b=crypto.getRandomValues(new Uint8Array(1))[0]; const j=b%(i+1); [values[i],values[j]]=[values[j],values[i]]; }
  return values.join('');
}
export function composeProvisioningToken(tokenPrefix,otp){
  const prefix=String(tokenPrefix||'').trim();
  const value=String(otp||'').replace(/\s+/g,'').trim();
  if(!prefix||!value) return '';
  return value.toUpperCase().startsWith(prefix.toUpperCase())?value:`${prefix}${value}`;
}
export function provisioningDisplayState({sessionState,accountStatus,providerSubAccountId,credentialReady}={}){
  const state=String(sessionState||'').toUpperCase();
  if(state) return state;
  if(String(accountStatus||'')==='ACTIVE'&&providerSubAccountId&&credentialReady) return 'READY';
  if(String(accountStatus||'')==='ACTIVE'&&providerSubAccountId) return 'MANUAL_REVIEW';
  return 'NOT_STARTED';
}

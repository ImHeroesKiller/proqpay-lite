// GT5.1 Master Account funding preflight — schema-free and side-effect free.
// This does not authorize payment; Controller approval and canonical DR checks remain mandatory.
export const MASTER_BALANCE_MAX_AGE_MS = 5 * 60 * 1000;

export function masterFundingReadiness({snapshot, credentialConfigured=false, executionContractValid=false, requiredAmount=0, nowMs=Date.now()}={}) {
  const required=Number(requiredAmount);
  if(!Number.isFinite(required)||required<0) return {ready:false,state:'INVALID_AMOUNT',availableBalance:null};
  if(!credentialConfigured) return {ready:false,state:'MASTER_CREDENTIAL_NOT_CONFIGURED',availableBalance:null};
  if(!snapshot) return {ready:false,state:'MASTER_BALANCE_NOT_SYNCED',availableBalance:null};
  const updated=new Date(snapshot.refreshed_at||0).getTime();
  const age=nowMs-updated;
  const balance=snapshot.balance===null||snapshot.balance===undefined?NaN:Number(snapshot.balance);
  if(!Number.isFinite(balance)||balance<0) return {ready:false,state:'MASTER_BALANCE_INVALID',availableBalance:null};
  if(!Number.isFinite(age)||age<0||age>MASTER_BALANCE_MAX_AGE_MS)
    return {ready:false,state:'MASTER_BALANCE_STALE',availableBalance:balance};
  if(!executionContractValid) return {ready:false,state:'MASTER_EXECUTION_CONTRACT_INVALID',availableBalance:balance};
  if(balance<required) return {ready:false,state:'MASTER_BALANCE_INSUFFICIENT',availableBalance:balance};
  return {ready:true,state:'READY',availableBalance:balance,requiredAmount:required,refreshedAt:snapshot.refreshed_at};
}

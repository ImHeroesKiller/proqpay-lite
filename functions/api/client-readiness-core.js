export function deriveClientReadiness(input={}){
  const clientActive=String(input.clientStatus||'').toUpperCase()==='ACTIVE';
  const employeeCount=Math.max(0,Number(input.employeeCount||0));
  const payrollCount=Math.max(0,Number(input.payrollCount||0));
  const providerStatus=String(input.providerStatus||'').toUpperCase();
  const providerSubAccountId=String(input.providerSubAccountId||'').trim();
  const provisioningState=String(input.provisioningState||'').toUpperCase();
  const credentialReady=Boolean(input.credentialReady);
  const paymentReady=clientActive && providerStatus==='ACTIVE' && Boolean(providerSubAccountId)
    && provisioningState==='READY' && credentialReady;

  return {
    client:{state:clientActive?'READY':'BLOCKED',ready:clientActive,blocking:false},
    employees:{state:employeeCount>0?'READY':'NOT_STARTED',ready:employeeCount>0,blocking:false,count:employeeCount},
    payroll:{state:clientActive?'READY':'BLOCKED',ready:clientActive,blocking:false,count:payrollCount},
    ewa:{state:clientActive?'CONFIGURABLE':'BLOCKED',ready:clientActive,blocking:false},
    payment:{
      state:paymentReady?'READY':!clientActive?'CLIENT_BLOCKED':providerStatus!=='ACTIVE'?'PROVIDER_PENDING':!providerSubAccountId?'PROVIDER_PENDING':provisioningState!=='READY'?'PROVISIONING_PENDING':!credentialReady?'CREDENTIAL_PENDING':'PROVIDER_PENDING',
      ready:paymentReady,
      blocking:true,
    },
    overall:{operationalReady:clientActive,paymentReady},
  };
}

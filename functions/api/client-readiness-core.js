export function deriveClientReadiness(input={}){
  const clientActive=String(input.clientStatus||'').toUpperCase()==='ACTIVE';
  const employeeCount=Math.max(0,Number(input.employeeCount||0));
  const payrollCount=Math.max(0,Number(input.payrollCount||0));
  // GT5 Master Account routing: client sub-accounts and their OTP credentials are obsolete.
  // This is provider setup readiness only; liquidity, limit, maker-checker and payment
  // execution retain their own strict server-side preflights.
  const masterActive=String(input.masterAccountStatus||'').toUpperCase()==='ACTIVE';
  const masterScoped=String(input.masterAccountScope||'').toUpperCase()==='MASTER';
  const credentialReady=Boolean(input.masterCredentialReady);
  const paymentReady=clientActive && masterActive && masterScoped && credentialReady;


  return {
    client:{state:clientActive?'READY':'BLOCKED',ready:clientActive,blocking:false},
    employees:{state:employeeCount>0?'READY':'NOT_STARTED',ready:employeeCount>0,blocking:false,count:employeeCount},
    payroll:{state:clientActive?'READY':'BLOCKED',ready:clientActive,blocking:false,count:payrollCount},
    ewa:{state:clientActive?'CONFIGURABLE':'BLOCKED',ready:clientActive,blocking:false},
    payment:{
      state:paymentReady?'READY':!clientActive?'CLIENT_BLOCKED':!masterActive||!masterScoped?'MASTER_ACCOUNT_PENDING':!credentialReady?'MASTER_CREDENTIAL_PENDING':'MASTER_ACCOUNT_PENDING',
      ready:paymentReady,
      blocking:true,
    },
    overall:{operationalReady:clientActive,paymentReady},
  };
}

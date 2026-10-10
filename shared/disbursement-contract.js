export const DISBURSEMENT_PURPOSES=Object.freeze(['PAYROLL','EWA']);
export const DISBURSEMENT_DESTINATIONS=Object.freeze(['DIRECT_EMPLOYEE','CLIENT_ACCOUNT']);
export const DISBURSEMENT_BENEFICIARY_TYPES=Object.freeze(['EMPLOYEE','CORPORATE']);
export const DISBURSEMENT_SOURCE_TYPES=Object.freeze(['PAYMENT_INSTRUCTION','EWA_REQUEST']);

export const DISBURSEMENT_INTENTS=Object.freeze({
  PAYROLL_DIRECT_EMPLOYEE:Object.freeze({
    purpose:'PAYROLL',
    destinationMode:'DIRECT_EMPLOYEE',
    beneficiaryType:'EMPLOYEE',
    sourceDocumentType:'PAYMENT_INSTRUCTION',
  }),
  PAYROLL_CLIENT_ACCOUNT:Object.freeze({
    purpose:'PAYROLL',
    destinationMode:'CLIENT_ACCOUNT',
    beneficiaryType:'CORPORATE',
    sourceDocumentType:'PAYMENT_INSTRUCTION',
  }),
  EWA_DIRECT_EMPLOYEE:Object.freeze({
    purpose:'EWA',
    destinationMode:'DIRECT_EMPLOYEE',
    beneficiaryType:'EMPLOYEE',
    sourceDocumentType:'EWA_REQUEST',
  }),
});

export const PROVISIONING_STATES=Object.freeze([
  'NOT_STARTED','REGISTERING','OTP_REQUIRED','ACTIVATING','VALIDATING',
  'READY','RETRYABLE_ERROR','MANUAL_REVIEW','SUSPENDED',
]);

export const DISBURSEMENT_STATES=Object.freeze([
  'DRAFT','READY','PENDING_APPROVAL','APPROVED','REJECTED','CANCELLED',
  'EXECUTING','PROCESSING','PARTIALLY_SETTLED','SETTLED','FAILED',
  'RECONCILIATION_REQUIRED','RECONCILED',
]);

export const DISBURSEMENT_TRANSITIONS=Object.freeze({
  DRAFT:Object.freeze(['READY','CANCELLED']),
  READY:Object.freeze(['PENDING_APPROVAL','CANCELLED']),
  PENDING_APPROVAL:Object.freeze(['APPROVED','REJECTED','CANCELLED']),
  APPROVED:Object.freeze(['EXECUTING','CANCELLED']),
  EXECUTING:Object.freeze(['PROCESSING','SETTLED','PARTIALLY_SETTLED','FAILED','RECONCILIATION_REQUIRED']),
  PROCESSING:Object.freeze(['SETTLED','PARTIALLY_SETTLED','FAILED','RECONCILIATION_REQUIRED']),
  PARTIALLY_SETTLED:Object.freeze(['PROCESSING','RECONCILIATION_REQUIRED','RECONCILED']),
  SETTLED:Object.freeze(['RECONCILED','RECONCILIATION_REQUIRED']),
  FAILED:Object.freeze(['RECONCILIATION_REQUIRED']),
  RECONCILIATION_REQUIRED:Object.freeze(['PROCESSING','SETTLED','PARTIALLY_SETTLED','FAILED','RECONCILED']),
  REJECTED:Object.freeze([]),
  CANCELLED:Object.freeze([]),
  RECONCILED:Object.freeze([]),
});

export function canonicalDisbursementIntent(input={}){
  const purpose=String(input.purpose||'').toUpperCase();
  const destinationMode=String(input.destinationMode||input.destination_mode||'').toUpperCase();
  const beneficiaryType=String(input.beneficiaryType||input.beneficiary_type||'').toUpperCase();
  const sourceDocumentType=String(input.sourceDocumentType||input.source_document_type||'').toUpperCase();
  return {purpose,destinationMode,beneficiaryType,sourceDocumentType};
}

export function validateDisbursementIntent(input={}){
  const value=canonicalDisbursementIntent(input);
  const allowed=Object.values(DISBURSEMENT_INTENTS).some((intent)=>
    intent.purpose===value.purpose
    && intent.destinationMode===value.destinationMode
    && intent.beneficiaryType===value.beneficiaryType
    && intent.sourceDocumentType===value.sourceDocumentType
  );
  return allowed
    ? {ok:true,...value}
    : {ok:false,code:'DISBURSEMENT_INTENT_UNSUPPORTED',...value};
}

export function providerChannelKey(input={}){
  const value=canonicalDisbursementIntent(input);
  return [value.purpose,value.destinationMode,value.beneficiaryType].join(':');
}

export function canTransitionDisbursement(from,to){
  const current=String(from||'').toUpperCase();
  const next=String(to||'').toUpperCase();
  return Boolean(DISBURSEMENT_TRANSITIONS[current]?.includes(next));
}

export type E2PayAccountSnapshot = {
  available:boolean;
  provider?:string;
  environment?:string;
  accountIdMasked?:string|null;
  accountName?:string|null;
  merchantStatus?:string|null;
  accountTypeName?:string|null;
  accountGroupName?:string|null;
  balance:number|null;
  phoneMasked?:string|null;
  bankCount?:number|null;
  refreshedAt?:string|null;
  funding?:{
    ready:boolean;
    bankName?:string|null;
    vaNumber?:string|null;
    accountName?:string|null;
  };
  executionContract?:{
    valid:boolean;
    environment:string;
    accountSrcMatchesMerchant:boolean|null;
    sourceIdConfigured:boolean;
    sourceIdVerification:string;
    passwordMd5Valid:boolean;
    issues:string[];
  };
  readiness?:{ configured:boolean; provider:string; environment?:string|null; reason?:string|null };
};

export type E2PayCatalogItem = {
  id:string;
  method:string;
  path:string;
  function:string;
  mode:'SERVER_MANAGED'|'ADMIN_ACTION'|'DIAGNOSTIC'|'LIVE_READ'|'PAYMENT_CONTROL_ONLY';
};

export type E2PayTransactionRow = {
  accountTransactionId?:string;
  clientRef?:string;
  description?:string;
  amount?:number;
  feeAmount?:number;
  creditAmount?:number;
  debitAmount?:number;
  balanceBefore?:number;
  balance?:number;
  transactionTimestamp?:string;
  transactionCode?:string;
  transactionName?:string;
  senderAccountId?:string;
  senderAccountName?:string;
  receiverAccountId?:string;
  receiverAccountName?:string;
  journalId?:string;
  refJournalId?:string;
  responseCode?:string;
  responseMessage?:string;
  merchantId?:string;
  merchantName?:string;
};

export class E2PayApiError extends Error {
  status:number;
  code?:string;
  stage?:string;
  providerStatus?:number|null;
  providerMessage?:string;
  correlationId?:string;
  constructor(message:string,response:Response,data:Record<string,unknown>={}){
    super(message);
    this.name='E2PayApiError';
    this.status=response.status;
    this.code=typeof data.code==='string'?data.code:undefined;
    this.stage=typeof data.stage==='string'?data.stage:undefined;
    this.providerStatus=typeof data.providerStatus==='number'?data.providerStatus:null;
    this.providerMessage=typeof data.providerMessage==='string'?data.providerMessage:undefined;
    this.correlationId=typeof data.correlationId==='string'?data.correlationId:undefined;
  }
}

async function parse(response:Response){
  const data=await response.json().catch(()=>({})) as Record<string,unknown>;
  if(!response.ok){
    const base=String(data.error||data.message||`HTTP ${response.status}`);
    const provider=typeof data.providerMessage==='string'&&data.providerMessage&&!base.includes(data.providerMessage)
      ? ` · ${data.providerMessage}`
      : '';
    const stage=typeof data.stage==='string'&&data.stage ? ` [${data.stage}]` : '';
    const correlation=typeof data.correlationId==='string'&&data.correlationId ? ` · ref ${data.correlationId}` : '';
    throw new E2PayApiError(base+provider+stage+correlation,response,data);
  }
  return data;
}

export async function getE2PayOverview(refresh=false){
  const params=new URLSearchParams({resource:'overview'});
  if(refresh) params.set('refresh','1');
  return parse(await fetch(`/api/e2pay-operations?${params}`,{headers:{Accept:'application/json'},cache:'no-store'})) as Promise<{
    ok:true;
    account:E2PayAccountSnapshot;
    catalogCount:number;
  }>;
}

export async function getE2PayCatalog(){
  return parse(await fetch('/api/e2pay-operations?resource=catalog',{headers:{Accept:'application/json'},cache:'no-store'})) as Promise<{
    ok:true;
    catalog:E2PayCatalogItem[];
    environment:string;
  }>;
}

export async function getE2PayBanks(filters:{name?:string;id?:string;limit?:number}={}){
  const params=new URLSearchParams({resource:'banks'});
  if(filters.name) params.set('name',filters.name);
  if(filters.id) params.set('id',filters.id);
  if(filters.limit) params.set('limit',String(filters.limit));
  return parse(await fetch(`/api/e2pay-operations?${params}`,{headers:{Accept:'application/json'},cache:'no-store'})) as Promise<{
    ok:true; rowCount:number; data:Array<{id:string;name:string;active:string|boolean}>;
  }>;
}

export async function getE2PayTransactions(filters:Record<string,string|number|undefined>={}){
  const params=new URLSearchParams({resource:'transactions'});
  for(const [key,value] of Object.entries(filters)) if(value!==undefined&&String(value).trim()) params.set(key,String(value));
  return parse(await fetch(`/api/e2pay-operations?${params}`,{headers:{Accept:'application/json'},cache:'no-store'})) as Promise<{
    ok:true; rowCount:number; data:E2PayTransactionRow[];
  }>;
}

export async function runE2PayAction(action:string,payload:Record<string,unknown>={}){
  return parse(await fetch('/api/e2pay-operations',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({action,...payload}),
  })) as Promise<Record<string,unknown>&{ok:true;action:string;correlationId?:string}>;
}


export type E2PaySubAccount = {
  id:string;
  clientId:string|null;
  projectId?:string|null;
  projectCode?:string|null;
  projectName?:string|null;
  clientCode?:string|null;
  clientName?:string|null;
  provider:string;
  environment:string;
  accountScope:'MASTER'|'SUB_ACCOUNT';
  providerAccountIdMasked?:string|null;
  providerSubAccountIdMasked?:string|null;
  accountName?:string|null;
  currency:string;
  status:'DRAFT'|'ACTIVE'|'INACTIVE';
  provisioningState?:'NOT_STARTED'|'PENDING_CONFIRMATION'|'PROVISIONED'|'FAILED'|'SUSPENDED';
  provisioningAttemptCount?:number;
  lastProvisioningAttemptAt?:string|null;
  lastProvisioningErrorCode?:string|null;
  lastProvisioningErrorMessage?:string|null;
  readiness?:{ready:boolean;reason:string};
  merchantCredential?:{ready:boolean;version:number|null;updatedAt?:string|null};
  parentSourceId?:string|null;
  provisioning?:{state:string;credentialMode:'SERVICE_MANAGED';phoneLast4?:string|null;lastErrorCode?:string|null;lastErrorMessage?:string|null;updatedAt?:string|null};
  balance:number|null;
  availableBalance:number|null;
  lastBalanceSyncAt?:string|null;
  createdAt?:string|null;
  updatedAt?:string|null;
  liquidity?:{state:string;ready:boolean;requiredAmount:number;availableBalance:number|null;gap:number;ageMs?:number};
};

export type E2PaySubAccountRegistry = {
  ok:true;
  provider:'E2PAY';
  environment:string;
  accounts:E2PaySubAccount[];
  clients:Array<{id:string;code:string;name:string;status:string}>;
  summary:{total:number;active:number;draft:number;inactive:number;unmappedClients:number};
  correlationId?:string;
};

export async function getE2PaySubAccounts(environment='UAT'){
  const params=new URLSearchParams({environment});
  return parse(await fetch(`/api/e2pay-subaccounts?${params}`,{headers:{Accept:'application/json'},cache:'no-store'})) as Promise<E2PaySubAccountRegistry>;
}

export async function upsertE2PaySubAccount(input:{
  clientId:string;
  environment:string;
  providerAccountId?:string;
  providerSubAccountId?:string;
  accountName?:string;
  status:'DRAFT'|'ACTIVE'|'INACTIVE';
}){
  return parse(await fetch('/api/e2pay-subaccounts',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({action:'UPSERT_SUBACCOUNT',...input}),
  })) as Promise<{ok:true;account:E2PaySubAccount;correlationId?:string}>;
}

export type E2PayRegistrationChallenge = {
  state:'OTP_REQUIRED'|'MANUAL_REVIEW'|'READY';
  phoneLast4?:string|null;
  credentialMode?:'SERVICE_MANAGED';
};

export function composeE2PayRegistrationToken(tokenPrefix:string,otp:string){
  return `${String(tokenPrefix||'').trim()}${String(otp||'').trim()}`;
}

export async function registerE2PaySubAccount(input:{clientId:string;projectId?:string;environment?:string;phone:string;email?:string}){
  return parse(await fetch('/api/e2pay-subaccounts',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({action:'REGISTER_SUBACCOUNT',environment:'UAT',...input}),
  })) as Promise<{ok:true;account:E2PaySubAccount;registration:E2PayRegistrationChallenge;pairing?:{clientId:string;projectId?:string|null;scope:'CLIENT'|'PROJECT_OVERRIDE'};correlationId?:string}>;
}

export async function activateE2PaySubAccount(input:{id:string;otp:string}){
  return parse(await fetch('/api/e2pay-subaccounts',{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'ACTIVATE_SUBACCOUNT',...input}),
  })) as Promise<{ok:true;account:E2PaySubAccount;provisioning:{state:'READY';credentialMode:'SERVICE_MANAGED'};correlationId?:string}>;
}

export async function confirmE2PaySubAccount(input:{id:string;username:string;password:string;token:string}){
  return parse(await fetch('/api/e2pay-subaccounts',{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'CONFIRM_SUBACCOUNT',...input}),
  })) as Promise<{ok:true;account:E2PaySubAccount;registration:{state:'PROVISIONED'};correlationId?:string}>;
}

export async function setE2PaySubAccountStatus(id:string,status:'DRAFT'|'ACTIVE'|'INACTIVE'){
  return parse(await fetch('/api/e2pay-subaccounts',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({action:'SET_SUBACCOUNT_STATUS',id,status}),
  })) as Promise<{ok:true;account:E2PaySubAccount;correlationId?:string}>;
}


export async function syncE2PaySubAccountBalance(id:string,requiredAmount=0){
  return parse(await fetch('/api/e2pay-subaccounts',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({action:'SYNC_BALANCE',id,requiredAmount}),
  })) as Promise<{ok:true;account:E2PaySubAccount;correlationId?:string}>;
}


export async function bindE2PaySubAccountCredential(input:{id:string;username:string;password:string}){
  return parse(await fetch('/api/e2pay-subaccounts',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({action:'BIND_SUBACCOUNT_CREDENTIAL',...input}),
  })) as Promise<{ok:true;account:E2PaySubAccount;credentialValidated:true;correlationId?:string}>;
}


export type E2PayUatLane = {
  submission:{id:string;clientId:string;clientName:string;period:string;paymentPeriod:string;state:string;expectedTotal:number;recipientCount:number};
  subAccount:{id:string;masked:string;status:string;availableBalance:number|null;lastBalanceSyncAt?:string|null}|null;
  liquidity:{state:string;ready:boolean;requiredAmount:number;availableBalance:number|null;gap:number;ageMs?:number};
  paymentInstruction:{id:string;documentNo?:string|null;status:string;expectedTotal:number;recipientCount:number;contentHash?:string|null;providerAccountRegistryId?:string|null;providerEnvironment?:string|null;providerSubAccountMasked?:string|null;createdAt?:string|null;updatedAt?:string|null}|null;
  transaction:{id:string;status:string;providerStatus?:string|null;amount:number;errorCode?:string|null;errorMessage?:string|null;providerAccountRegistryId?:string|null;providerSubAccountMasked?:string|null;createdAt?:string|null;updatedAt?:string|null;paidAt?:string|null}|null;
  itemSummary:{total:number;succeeded:number;unresolved:number;failed:number;retryReady:number};
  phase:string;
};

export async function getE2PayUatValidation(){
  return parse(await fetch('/api/e2pay-uat-validation',{headers:{Accept:'application/json'},cache:'no-store'})) as Promise<{
    ok:true;
    provider:'E2PAY';
    environment:'UAT';
    authority:{financialExecutionRole:'PAYROLL_CONTROLLER';rawDisbursementDisabled:boolean;paymentControlOnly:boolean};
    canary:E2PayUatLane|null;
    batch:E2PayUatLane|null;
    protocol:string[];
  }>;
}


export type E2PayFundingState = {
  providerAccountRegistryId:string;
  clientId:string;
  clientCode?:string|null;
  clientName?:string|null;
  projectId?:string|null;
  projectCode?:string|null;
  projectName?:string|null;
  environment:string;
  providerSubAccountIdMasked?:string|null;
  provisioningState?:string;
  merchantCredential?:{ready:boolean;version:number|null;updatedAt?:string|null};
  accountReadiness?:{ready:boolean;reason:string};
  ready:boolean;
  state:string;
  requiredAmount:number;
  effectiveDisbursementCapacity:number;
  approvalCapacity:number;
  parent:{ready:boolean;state:string;balance:number|null;refreshedAt?:string|null;ageMs?:number|null};
  subClient:{ready:boolean;state:string;availableBalance:number|null;checkedAt?:string|null;ageMs?:number|null;accountId?:string|null;accountLast4?:string|null};
  limit:{ready:boolean;state:string;id?:string|null;approvedAmount:number;committedAmount:number;currentCommittedAmount:number;remainingAmount:number;capacityForPayment:number;expiresAt?:string|null;approvedAt?:string|null};
};

export type E2PayDisbursementLimitRequest = {
  id:string;
  providerAccountRegistryId:string;
  clientId:string;
  clientCode?:string|null;
  clientName?:string|null;
  projectId?:string|null;
  projectCode?:string|null;
  projectName?:string|null;
  environment:string;
  requestedAmount:number;
  approvedAmount:number|null;
  committedAmount:number;
  remainingAmount:number;
  status:'PENDING_APPROVAL'|'ACTIVE'|'REJECTED'|'REVOKED'|'EXHAUSTED'|'EXPIRED';
  reason?:string|null;
  requestedByEmail:string;
  requestedAt:string;
  approvedByEmail?:string|null;
  approvedAt?:string|null;
  rejectedReason?:string|null;
  expiresAt?:string|null;
};

export async function getE2PayDisbursementLimits(filters:{providerAccountRegistryId?:string;requiredAmount?:number}={}){
  const params=new URLSearchParams();
  if(filters.providerAccountRegistryId) params.set('providerAccountRegistryId',filters.providerAccountRegistryId);
  if(filters.requiredAmount) params.set('requiredAmount',String(filters.requiredAmount));
  return parse(await fetch('/api/e2pay-disbursement-limits?'+params.toString(),{headers:{Accept:'application/json'},cache:'no-store'})) as Promise<{
    ok:true;
    funding:E2PayFundingState[];
    requests:E2PayDisbursementLimitRequest[];
    authority:{canRequest:boolean;canApprove:boolean;canMonitor:boolean};
    correlationId?:string;
  }>;
}

export async function requestE2PayDisbursementLimit(input:{providerAccountRegistryId:string;amount:number;reason:string;expiresAt?:string}){
  return parse(await fetch('/api/e2pay-disbursement-limits',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({action:'REQUEST_LIMIT',...input}),
  })) as Promise<Record<string,unknown>&{ok:true;correlationId?:string}>;
}

export async function approveE2PayDisbursementLimit(id:string){
  return parse(await fetch('/api/e2pay-disbursement-limits',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({action:'APPROVE_LIMIT',id}),
  })) as Promise<Record<string,unknown>&{ok:true;correlationId?:string}>;
}

export async function rejectE2PayDisbursementLimit(id:string,reason:string){
  return parse(await fetch('/api/e2pay-disbursement-limits',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({action:'REJECT_LIMIT',id,reason}),
  })) as Promise<Record<string,unknown>&{ok:true;correlationId?:string}>;
}

export async function revokeE2PayDisbursementLimit(id:string,reason:string){
  return parse(await fetch('/api/e2pay-disbursement-limits',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({action:'REVOKE_LIMIT',id,reason}),
  })) as Promise<Record<string,unknown>&{ok:true;correlationId?:string}>;
}

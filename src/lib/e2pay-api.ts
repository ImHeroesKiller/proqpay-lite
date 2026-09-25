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

async function parse(response:Response){
  const data=await response.json().catch(()=>({}));
  if(!response.ok) throw new Error(data.error||data.message||`HTTP ${response.status}`);
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

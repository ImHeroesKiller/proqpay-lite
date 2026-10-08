import { fetchWithSecurityStepUp } from './security-step-up';
import type { DashboardApiResponse } from './dashboard-types';
import type { PaymentInstructionDetail } from './payment-instruction-ui';

export type OperatingResource =
  | 'dashboard'
  | 'dashboard-periods'
  | 'service-plans'
  | 'pay-run-setup'
  | 'pay-run-detail'
  | 'submissions'
  | 'exceptions'
  | 'exception-history'
  | 'payment-instructions'
  | 'payment-instruction-detail'
  | 'payment-proofs'
  | 'reconciliations'
  | 'payment-reports'
  | 'integrations';

const CACHE_TTL_MS = 15_000;
const responseCache = new Map<string, { expiresAt: number; data: unknown }>();
const inflightRequests = new Map<string, Promise<unknown>>();
let cacheActorNamespace = 'anonymous';

async function parseResponse<T=unknown>(response: Response):Promise<T> {
  const data = await response.json().catch(() => ({})) as Record<string,unknown>;
  if (!response.ok) {
    const message = typeof data.error === 'string' ? data.error : typeof data.message === 'string' ? data.message : `HTTP ${response.status}`;
    throw new Error(message);
  }
  return data as T;
}

function cacheKey(url:string){ return `${cacheActorNamespace}:${url}`; }

function cachedOperatingGet<T=unknown>(url: string):Promise<T> {
  const key=cacheKey(url);
  const cached = responseCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.data as T);
  const pending = inflightRequests.get(key);
  if (pending) return pending as Promise<T>;
  const request = fetch(url, { headers:{ Accept:'application/json' } })
    .then((response)=>parseResponse<T>(response))
    .then((data) => {
      responseCache.set(key, { data, expiresAt:Date.now() + CACHE_TTL_MS });
      return data;
    })
    .finally(() => inflightRequests.delete(key));
  inflightRequests.set(key, request as Promise<unknown>);
  return request;
}

export async function listOperatingResource<T=any>(resource: OperatingResource, clientId?: string):Promise<T> {
  const params = new URLSearchParams({ resource });
  if (clientId) params.set('clientId', clientId);
  return cachedOperatingGet<T>(`/api/operating-model?${params}`);
}

export async function listAllOperatingSubmissions(clientId?:string):Promise<{submissions:any[];submissionsMeta:{returned:number;truncated:boolean}}> {
  const submissions:any[]=[];
  let offset=0;
  while(true){
    const params=new URLSearchParams({resource:'submissions',offset:String(offset),limit:'500'});
    if(clientId) params.set('clientId',clientId);
    const page=await cachedOperatingGet<any>(`/api/operating-model?${params}`);
    submissions.push(...(page.submissions||[]));
    if(page.submissionsMeta?.nextOffset==null) break;
    offset=Number(page.submissionsMeta.nextOffset);
  }
  return {submissions,submissionsMeta:{returned:submissions.length,truncated:false}};
}

export async function listAllOperatingExceptions(clientId?:string):Promise<{exceptions:any[];exceptionsMeta:{returned:number;truncated:boolean}}> {
  const exceptions:any[]=[];
  let offset=0;
  while(true){
    const params=new URLSearchParams({resource:'exceptions',offset:String(offset),limit:'500'});
    if(clientId) params.set('clientId',clientId);
    const page=await cachedOperatingGet<any>(`/api/operating-model?${params}`);
    exceptions.push(...(page.exceptions||[]));
    if(page.exceptionsMeta?.nextOffset==null) break;
    offset=Number(page.exceptionsMeta.nextOffset);
  }
  return {exceptions,exceptionsMeta:{returned:exceptions.length,truncated:false}};
}


export async function listAllPaginatedOperatingResource(resource:'payment-instructions'|'payment-proofs'|'reconciliations', clientId?:string):Promise<Record<string,unknown>> {
  const key=resource==='payment-instructions'?'paymentInstructions':resource==='payment-proofs'?'paymentProofs':'reconciliations';
  const metaKey=resource==='payment-instructions'?'paymentInstructionsMeta':resource==='payment-proofs'?'paymentProofsMeta':'reconciliationsMeta';
  const rows:any[]=[];
  let offset=0;
  while(true){
    const params=new URLSearchParams({resource,offset:String(offset),limit:'500'});
    if(clientId) params.set('clientId',clientId);
    const page=await cachedOperatingGet<any>(`/api/operating-model?${params}`);
    rows.push(...(page[key]||[]));
    const nextOffset=page[metaKey]?.nextOffset;
    if(nextOffset==null) break;
    offset=Number(nextOffset);
  }
  return {[key]:rows,[metaKey]:{returned:rows.length,truncated:false,nextOffset:null}};
}

export async function getExceptionHistory(exceptionId:string):Promise<{exceptionHistory:any[]}> {
  const params=new URLSearchParams({resource:'exception-history',exceptionId});
  return cachedOperatingGet<{exceptionHistory:any[]}>(`/api/operating-model?${params}`);
}

export function listOperatingDashboard(clientId?: string, period?: string):Promise<DashboardApiResponse> {
  const baseParams = new URLSearchParams({ resource:'dashboard' });
  if (clientId) baseParams.set('clientId', clientId);
  if (period && period !== 'ALL') baseParams.set('period', period);
  const aggregateUrl = `/api/operating-model?${baseParams}&aggregate=all`;
  const aggregateKey = cacheKey(aggregateUrl);
  const cached = responseCache.get(aggregateKey);
  if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.data as DashboardApiResponse);
  const pending = inflightRequests.get(aggregateKey);
  if (pending) return pending as Promise<DashboardApiResponse>;

  const request:Promise<DashboardApiResponse> = (async()=>{
    const merged:Pick<DashboardApiResponse,'submissions'|'paymentInstructions'> = { submissions:[], paymentInstructions:[] };
    let offset = 0;
    let first:DashboardApiResponse|null = null;
    while (true) {
      const pageParams = new URLSearchParams(baseParams);
      if (offset) pageParams.set('offset', String(offset));
      const page = await cachedOperatingGet<DashboardApiResponse>(`/api/operating-model?${pageParams}`);
      if (!first) first = page;
      merged.submissions.push(...(page.submissions || []));
      merged.paymentInstructions.push(...(page.paymentInstructions || []));
      const nextOffset = page.dashboardMeta?.nextOffset;
      if (nextOffset == null) break;
      offset = Number(nextOffset);
    }
    if (!first) return { submissions:[], paymentInstructions:[] };
    const result:DashboardApiResponse = {
      ...first,
      ...merged,
      dashboardMeta:{
        ...(first?.dashboardMeta || {}),
        submissionsReturned:merged.submissions.length,
        nextOffset:null,
        truncated:false,
      },
    };
    responseCache.set(aggregateKey,{data:result,expiresAt:Date.now()+CACHE_TTL_MS});
    return result;
  })().finally(()=>inflightRequests.delete(aggregateKey));

  inflightRequests.set(aggregateKey,request as Promise<unknown>);
  return request;
}

export async function listOperatingPeriods(clientId?: string):Promise<{periods:string[]}> {
  const result = await listOperatingResource<{periods?:unknown[]}>('dashboard-periods', clientId);
  return { periods:Array.isArray(result.periods) ? result.periods.map(String) : [] };
}

export function setOperatingCacheActor(actor?:{id?:string|null;email?:string|null;role?:string|null}|null) {
  const next = actor ? [actor.id||'',actor.email||'',actor.role||''].join('|') : 'anonymous';
  if (next === cacheActorNamespace) return;
  cacheActorNamespace = next;
  responseCache.clear();
  inflightRequests.clear();
}

export function invalidateOperatingCache() {
  responseCache.clear();
  inflightRequests.clear();
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('proqpay:operating-cache-invalidated'));
  }
}

export async function getPaymentInstructionDetail(paymentInstructionId: string):Promise<PaymentInstructionDetail> {
  const params = new URLSearchParams({ resource:'payment-instruction-detail', paymentInstructionId });
  return parseResponse<PaymentInstructionDetail>(await fetch(`/api/operating-model?${params}`, { headers:{Accept:'application/json'} }));
}

export async function getPayRunDetail(submissionId: string):Promise<any> {
  const params = new URLSearchParams({ resource:'pay-run-detail', submissionId });
  return parseResponse<any>(await fetch(`/api/operating-model?${params}`, { headers:{Accept:'application/json'} }));
}

export async function executeOperatingAction(action: Record<string, unknown>):Promise<any> {
  const result = await parseResponse<any>(await fetchWithSecurityStepUp('/api/operating-model', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(action),
  }));
  invalidateOperatingCache();
  return result;
}

import type { DashboardApiResponse } from './dashboard-types';

export type OperatingResource =
  | 'dashboard'
  | 'dashboard-periods'
  | 'service-plans'
  | 'pay-run-setup'
  | 'pay-run-detail'
  | 'submissions'
  | 'exceptions'
  | 'payment-instructions'
  | 'payment-instruction-detail'
  | 'payment-proofs'
  | 'reconciliations'
  | 'payment-reports'
  | 'integrations';

const CACHE_TTL_MS = 15_000;
const responseCache = new Map<string, { expiresAt: number; data: unknown }>();
const inflightRequests = new Map<string, Promise<unknown>>();

async function parseResponse<T=unknown>(response: Response):Promise<T> {
  const data = await response.json().catch(() => ({})) as Record<string,unknown>;
  if (!response.ok) {
    const message = typeof data.error === 'string' ? data.error : typeof data.message === 'string' ? data.message : `HTTP ${response.status}`;
    throw new Error(message);
  }
  return data as T;
}

function cachedOperatingGet<T=unknown>(url: string):Promise<T> {
  const cached = responseCache.get(url);
  if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.data as T);
  const pending = inflightRequests.get(url);
  if (pending) return pending as Promise<T>;
  const request = fetch(url, { headers:{ Accept:'application/json' } })
    .then((response)=>parseResponse<T>(response))
    .then((data) => {
      responseCache.set(url, { data, expiresAt:Date.now() + CACHE_TTL_MS });
      return data;
    })
    .finally(() => inflightRequests.delete(url));
  inflightRequests.set(url, request as Promise<unknown>);
  return request;
}

export async function listOperatingResource<T=any>(resource: OperatingResource, clientId?: string):Promise<T> {
  const params = new URLSearchParams({ resource });
  if (clientId) params.set('clientId', clientId);
  return cachedOperatingGet<T>(`/api/operating-model?${params}`);
}

export function listOperatingDashboard(clientId?: string, period?: string):Promise<DashboardApiResponse> {
  const baseParams = new URLSearchParams({ resource:'dashboard' });
  if (clientId) baseParams.set('clientId', clientId);
  if (period && period !== 'ALL') baseParams.set('period', period);
  const aggregateKey = `/api/operating-model?${baseParams}&aggregate=all`;
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

export function invalidateOperatingCache() {
  responseCache.clear();
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('proqpay:operating-cache-invalidated'));
  }
}

export async function getPaymentInstructionDetail(paymentInstructionId: string) {
  const params = new URLSearchParams({ resource:'payment-instruction-detail', paymentInstructionId });
  return parseResponse(await fetch(`/api/operating-model?${params}`, { headers:{Accept:'application/json'} }));
}

export async function getPayRunDetail(submissionId: string) {
  const params = new URLSearchParams({ resource:'pay-run-detail', submissionId });
  return parseResponse(await fetch(`/api/operating-model?${params}`, { headers:{Accept:'application/json'} }));
}

export async function executeOperatingAction(action: Record<string, unknown>) {
  const result = await parseResponse(await fetch('/api/operating-model', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(action),
  }));
  invalidateOperatingCache();
  return result;
}

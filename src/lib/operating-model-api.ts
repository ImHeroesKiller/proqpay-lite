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
const responseCache = new Map<string, { expiresAt: number; data: any }>();
const inflightRequests = new Map<string, Promise<any>>();

async function parseResponse(response: Response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || data.message || `HTTP ${response.status}`);
  }
  return data;
}

function cachedOperatingGet(url: string) {
  const cached = responseCache.get(url);
  if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.data);
  const pending = inflightRequests.get(url);
  if (pending) return pending;
  const request = fetch(url, { headers:{ Accept:'application/json' } })
    .then(parseResponse)
    .then((data) => {
      responseCache.set(url, { data, expiresAt:Date.now() + CACHE_TTL_MS });
      return data;
    })
    .finally(() => inflightRequests.delete(url));
  inflightRequests.set(url, request);
  return request;
}

export async function listOperatingResource(resource: OperatingResource, clientId?: string) {
  const params = new URLSearchParams({ resource });
  if (clientId) params.set('clientId', clientId);
  return cachedOperatingGet(`/api/operating-model?${params}`);
}

export function listOperatingDashboard(clientId?: string, period?: string) {
  const baseParams = new URLSearchParams({ resource:'dashboard' });
  if (clientId) baseParams.set('clientId', clientId);
  if (period && period !== 'ALL') baseParams.set('period', period);
  const aggregateKey = `/api/operating-model?${baseParams}&aggregate=all`;
  const cached = responseCache.get(aggregateKey);
  if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.data);
  const pending = inflightRequests.get(aggregateKey);
  if (pending) return pending;

  const request = (async()=>{
    const merged:any = { submissions:[], paymentInstructions:[] };
    let offset = 0;
    let first:any = null;
    while (true) {
      const pageParams = new URLSearchParams(baseParams);
      if (offset) pageParams.set('offset', String(offset));
      const page = await cachedOperatingGet(`/api/operating-model?${pageParams}`);
      if (!first) first = page;
      merged.submissions.push(...(page.submissions || []));
      merged.paymentInstructions.push(...(page.paymentInstructions || []));
      const nextOffset = page.dashboardMeta?.nextOffset;
      if (nextOffset == null) break;
      offset = Number(nextOffset);
    }
    const result = {
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

  inflightRequests.set(aggregateKey,request);
  return request;
}

export function listOperatingPeriods(clientId?: string) {
  return listOperatingResource('dashboard-periods', clientId);
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

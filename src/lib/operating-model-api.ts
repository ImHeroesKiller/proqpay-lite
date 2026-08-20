export type OperatingResource =
  | 'dashboard'
  | 'service-plans'
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

export async function listOperatingResource(resource: OperatingResource, clientId?: string) {
  const params = new URLSearchParams({ resource });
  if (clientId) params.set('clientId', clientId);
  const url = `/api/operating-model?${params}`;
  const cached = responseCache.get(url);
  if (cached && cached.expiresAt > Date.now()) return cached.data;
  const pending = inflightRequests.get(url);
  if (pending) return pending;
  const request = fetch(url, { headers: { Accept: 'application/json' } })
    .then(parseResponse)
    .then((data) => {
      responseCache.set(url, { data, expiresAt: Date.now() + CACHE_TTL_MS });
      return data;
    })
    .finally(() => inflightRequests.delete(url));
  inflightRequests.set(url, request);
  return request;
}

export function listOperatingDashboard(clientId?: string) {
  return listOperatingResource('dashboard', clientId);
}

export function invalidateOperatingCache() {
  responseCache.clear();
}

export async function getPaymentInstructionDetail(paymentInstructionId: string) {
  const params = new URLSearchParams({ resource:'payment-instruction-detail', paymentInstructionId });
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

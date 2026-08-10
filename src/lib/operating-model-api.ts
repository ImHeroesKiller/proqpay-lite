export type OperatingResource =
  | 'service-plans'
  | 'submissions'
  | 'exceptions'
  | 'payment-instructions'
  | 'payment-proofs'
  | 'reconciliations'
  | 'integrations';

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
  return parseResponse(await fetch(`/api/operating-model?${params}`, {
    headers: { Accept: 'application/json' },
  }));
}

export async function executeOperatingAction(action: Record<string, unknown>) {
  return parseResponse(await fetch('/api/operating-model', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(action),
  }));
}

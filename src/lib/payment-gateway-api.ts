export type PaymentGatewayReadiness = {
  configured: boolean;
  provider: string;
  reason?: string | null;
};

export type PaymentGatewayTransaction = {
  id: string;
  payment_instruction_id: string;
  provider: string;
  provider_transaction_id?: string | null;
  provider_reference?: string | null;
  status: 'CREATED' | 'PENDING' | 'PROCESSING' | 'SUCCEEDED' | 'FAILED' | 'EXPIRED' | 'CANCELLED';
  provider_status?: string | null;
  amount: number;
  currency: string;
  payment_method?: string | null;
  created_at: string;
  updated_at: string;
  paid_at?: string | null;
};

export type HostedPaymentSession = {
  id: string;
  payment_instruction_id: string;
  payment_gateway_transaction_id: string;
  provider: string;
  provider_session_id?: string | null;
  status: 'CREATED' | 'READY' | 'OPENED' | 'RETURNED' | 'EXPIRED' | 'CANCELLED' | 'FAILED' | 'COMPLETED';
  checkout_url?: string | null;
  return_path: string;
  expires_at: string;
  returned_at?: string | null;
  completed_at?: string | null;
  created_at: string;
  updated_at?: string;
};

async function parseResponse(response: Response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || data.message || `HTTP ${response.status}`);
  return data;
}

export async function getPaymentGatewayStatus(paymentInstructionId?: string) {
  const params = new URLSearchParams();
  if (paymentInstructionId) params.set('paymentInstructionId', paymentInstructionId);
  const suffix = params.size ? `?${params}` : '';
  return parseResponse(await fetch(`/api/payment-gateway${suffix}`, {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  })) as Promise<{
    ok: true;
    gateway: PaymentGatewayReadiness;
    transaction?: PaymentGatewayTransaction | null;
  }>;
}

export async function executeSeamlessPayment(paymentInstructionId: string, paymentMethod?: string) {
  return parseResponse(await fetch('/api/payment-gateway', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paymentInstructionId, paymentMethod }),
  })) as Promise<{
    ok: true;
    gateway: PaymentGatewayReadiness;
    transaction: PaymentGatewayTransaction;
    idempotentReplay?: boolean;
  }>;
}

export async function getHostedPaymentStatus(paymentInstructionId?: string) {
  const params = new URLSearchParams();
  if (paymentInstructionId) params.set('paymentInstructionId', paymentInstructionId);
  const suffix = params.size ? `?${params}` : '';
  return parseResponse(await fetch(`/api/payment-gateway-hosted${suffix}`, {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  })) as Promise<{
    ok: true;
    hosted: PaymentGatewayReadiness;
    session?: HostedPaymentSession | null;
  }>;
}

export async function createHostedPaymentSession(paymentInstructionId: string, returnPath = '/?view=payments') {
  return parseResponse(await fetch('/api/payment-gateway-hosted', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paymentInstructionId, returnPath }),
  })) as Promise<{
    ok: true;
    hosted: PaymentGatewayReadiness;
    session: HostedPaymentSession;
    idempotentReplay?: boolean;
  }>;
}

export async function openHostedPayment(paymentInstructionId: string, returnPath = '/?view=payments') {
  const result = await createHostedPaymentSession(paymentInstructionId, returnPath);
  if (!result.session.checkout_url) throw new Error('Hosted checkout URL tidak tersedia');
  window.location.assign(result.session.checkout_url);
  return result;
}

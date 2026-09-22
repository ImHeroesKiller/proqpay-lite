export type PaymentGatewayReadiness = {
  configured: boolean;
  provider: string;
  reason?: string | null;
  environment?: string | null;
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


export type PaymentGatewayItem = {
  id: string;
  payment_instruction_line_id: string;
  employee_id?: string | null;
  provider: string;
  client_ref: string;
  bank_id?: string | null;
  beneficiary_name: string;
  provider_beneficiary_name?: string | null;
  account_last4: string;
  amount: number;
  fee_amount: number;
  journal_id?: string | null;
  correlation_id?: string | null;
  response_code?: string | null;
  response_message?: string | null;
  status: 'CREATED' | 'INQUIRY_READY' | 'PENDING' | 'PROCESSING' | 'SUCCEEDED' | 'FAILED' | 'UNKNOWN';
  attempt_count: number;
  last_checked_at?: string | null;
  error_code?: string | null;
  error_message?: string | null;
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
    items?: PaymentGatewayItem[];
  }>;
}

export async function executeSeamlessPayment(paymentInstructionId: string, paymentMethod?: string) {
  return parseResponse(await fetch('/api/payment-gateway', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paymentInstructionId, paymentMethod, action:'EXECUTE' }),
  })) as Promise<{
    ok: true;
    gateway: PaymentGatewayReadiness;
    transaction: PaymentGatewayTransaction;
    idempotentReplay?: boolean;
    hasMore?: boolean;
    remaining?: number;
    processedThisCall?: number;
    chunkLimit?: number;
    blockedByUnresolved?: boolean;
    parentStatus?: string;
    items?: PaymentGatewayItem[];
    summary?: {
      total: number;
      succeeded: number;
      processing: number;
      failed: number;
      ready: number;
      amount: number;
      fees: number;
      requiredBalance: number;
    };
  }>;
}


export async function retryFailedE2PayPayment(paymentInstructionId: string) {
  return parseResponse(await fetch('/api/payment-gateway', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paymentInstructionId, action:'RETRY_FAILED' }),
  })) as Promise<{
    ok: boolean;
    gateway: PaymentGatewayReadiness;
    transaction: PaymentGatewayTransaction;
    items?: PaymentGatewayItem[];
    summary?: {
      total: number;
      succeeded: number;
      processing: number;
      failed: number;
      ready: number;
      amount: number;
      fees: number;
      requiredBalance: number;
    };
  }>;
}

export async function reconcileE2PayPayment(paymentInstructionId: string) {
  return parseResponse(await fetch('/api/payment-gateway', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paymentInstructionId, action:'RECONCILE' }),
  })) as Promise<{
    ok: boolean;
    gateway: PaymentGatewayReadiness;
    transaction: PaymentGatewayTransaction;
    items?: PaymentGatewayItem[];
    summary?: {
      total: number;
      succeeded: number;
      processing: number;
      failed: number;
      ready: number;
      amount: number;
      fees: number;
      requiredBalance: number;
    };
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

export async function fetchWithSecurityStepUp(input: RequestInfo | URL, init?: RequestInit) {
  let response = await fetch(input, init);
  if (response.status !== 428) return response;

  const challenge = await response.clone().json().catch(() => ({})) as Record<string, unknown>;
  if (challenge.code !== 'MFA_STEP_UP_REQUIRED' || typeof window === 'undefined') return response;

  const code = window.prompt('Masukkan kode MFA 6 digit untuk melanjutkan aksi pembayaran:')?.replace(/\D/g, '').slice(0, 6);
  if (!code || code.length !== 6) return response;

  const stepUp = await fetch('/api/security-mfa', {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({action:'STEP_UP',code}),
  });
  if (!stepUp.ok) {
    const detail = await stepUp.json().catch(() => ({})) as Record<string, unknown>;
    throw new Error(typeof detail.error === 'string' ? detail.error : 'Verifikasi MFA gagal');
  }

  // One retry only. Further 428/4xx responses are handled by the original caller.
  response = await fetch(input, init);
  return response;
}

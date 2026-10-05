const encoder = new TextEncoder();

function bytesToHex(bytes) {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function securitySecret(env = {}) {
  const secret = String(
    env.SECURITY_CONTEXT_KEY
      || env.SECURITY_MFA_KEY
      || env.EMPLOYEE_BANK_ENCRYPTION_KEY
      || env.PI_ENCRYPTION_KEY
      || ''
  );
  return secret.length >= 32 ? secret : '';
}

export async function sha256Hex(value) {
  return bytesToHex(await crypto.subtle.digest('SHA-256', encoder.encode(String(value ?? ''))));
}

export async function protectedHash(value, env = {}, namespace = 'SECURITY') {
  const secret = securitySecret(env);
  if (!secret) return null;
  return sha256Hex(`${namespace}|${secret}|${String(value ?? '').trim().toLowerCase()}`);
}

export async function requestSecurityContext(request, env = {}) {
  const ip = String(
    request.headers.get('CF-Connecting-IP')
      || request.headers.get('X-Forwarded-For')
      || ''
  ).split(',')[0].trim();
  const userAgent = String(request.headers.get('User-Agent') || '').trim();
  // Keep the session fingerprint stable across navigation/refresh. Accept-Language
  // and Sec-CH-UA brand/version hints can legitimately vary between browser
  // navigation and fetch requests and must not invalidate an authenticated session.
  const platform = String(request.headers.get('Sec-CH-UA-Platform') || '').trim();
  const mobile = String(request.headers.get('Sec-CH-UA-Mobile') || '').trim();
  const deviceSource = [userAgent, platform, mobile].join('|');
  return {
    ipHash: ip ? await protectedHash(ip, env, 'IP') : null,
    deviceHash: deviceSource.trim() ? await protectedHash(deviceSource, env, 'DEVICE') : null,
  };
}

export function isCriticalMfaRole(role) {
  return ['SUPER_ADMIN', 'PAYROLL_CONTROLLER'].includes(String(role || '').toUpperCase());
}

export function isRequiredMfaRole(role) {
  return ['SUPER_ADMIN', 'PAYROLL_CONTROLLER', 'PAYROLL_PROCESSOR'].includes(String(role || '').toUpperCase());
}

export function mfaEnforcementMode(env = {}) {
  const mode = String(env.SECURITY_MFA_ENFORCEMENT || 'AUDIT').trim().toUpperCase();
  return mode === 'ENFORCE' ? 'ENFORCE' : 'AUDIT';
}

export function hasRecentMfa(actor, windowSeconds = 600) {
  const verifiedAt = actor?.mfaVerifiedAt ? Date.parse(String(actor.mfaVerifiedAt)) : Number.NaN;
  if (!Number.isFinite(verifiedAt)) return false;
  const maxAgeMs = Math.max(60, Number(windowSeconds || 600)) * 1000;
  return Date.now() - verifiedAt <= maxAgeMs;
}

export async function fraudValueHash(blockType, value, env = {}) {
  const type = String(blockType || '').trim().toUpperCase();
  let normalized = String(value ?? '').trim();
  if (type === 'EMAIL') normalized = normalized.toLowerCase();
  if (type === 'BANK_ACCOUNT') normalized = normalized.replace(/\D/g, '');
  return protectedHash(normalized, env, `FRAUD:${type}`);
}

export function safeLast4(value) {
  const compact = String(value ?? '').replace(/\s+/g, '');
  return compact ? compact.slice(-4) : null;
}

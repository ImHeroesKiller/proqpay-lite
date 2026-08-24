import { authenticateEmployee, employeeHandlePreflight, employeeJson } from '../_employee-auth.js';
import { d1First, hasD1 } from '../_d1.js';
import { buildEmployeePortalPayload } from '../_employee-init.js';
import { publicError } from '../_security.js';

const METHODS = 'GET, OPTIONS';
const KNOWN_PAYROLL_STATES = new Set([
  'DRAFT','EXCEPTION_FOUND','EXCEPTION_REVIEW','CLIENT_ACTION_REQUIRED','REVISION_REQUIRED','REJECTED','CANCELLED',
  'SUBMITTED','INGESTING','AI_VALIDATING','CLIENT_RESUBMITTED','VALIDATED','STANDARDIZED','PROCESSOR_REVIEW',
  'CONTROLLER_REVIEW','DATA_APPROVED','PAYROLL_FINALIZED','PAYMENT_INSTRUCTION_READY','PAYMENT_APPROVAL_PENDING',
  'APPROVED_FOR_PAYMENT','DISBURSEMENT_PROCESSING','PROOF_UPLOADED','RECONCILIATION','PAYMENT_EXCEPTION','COMPLETED',
]);

async function attachCanonicalState(database, actor, payload) {
  const latest = await d1First(database, `SELECT s.state FROM payroll_submissions s
    WHERE EXISTS (SELECT 1 FROM payroll_run_lines l
      WHERE l.submission_id=s.id AND l.employee_id=? AND l.included=1)
    ORDER BY s.period DESC,s.created_at DESC LIMIT 1`, [actor.id]);
  const state = String(latest?.state || '').trim().toUpperCase();
  if (!payload?.config?.payroll) return payload;
  payload.config.payroll.state = state || null;
  payload.config.payroll.needsReview = Boolean(state && !KNOWN_PAYROLL_STATES.has(state));
  if (payload.config.payroll.needsReview) {
    // Unknown states must never masquerade as Data Readiness (stage 1) or Paid.
    payload.config.payroll.stage = 2;
    payload.config.notifications = Array.isArray(payload.config.notifications) ? payload.config.notifications : [];
    payload.config.notifications.unshift({
      title: 'Payroll status needs review',
      s: `Status ${state} belum dikenali oleh Employee Portal. Data pembayaran tidak dianggap selesai sampai status tervalidasi.`,
      type: 'warning',
      unread: true,
    });
  }
  return payload;
}

export async function onRequest({ request, env }) {
  if (request.method === 'OPTIONS') return employeeHandlePreflight(request, env, METHODS);
  if (request.method !== 'GET') return employeeJson({ error: 'Method not allowed' }, 405, request, env, METHODS);
  if (!hasD1(env)) {
    return employeeJson({ error: 'Cloudflare D1 binding unavailable', code: 'D1_REQUIRED' }, 503, request, env, METHODS);
  }
  const actor = await authenticateEmployee(request, env);
  if (!actor) return employeeJson({ error: 'Sesi tidak valid atau kedaluwarsa.' }, 401, request, env, METHODS);
  try {
    const payload = await buildEmployeePortalPayload(env.DB, actor);
    if (!payload) return employeeJson({ error: 'Karyawan tidak ditemukan.' }, 404, request, env, METHODS);
    await attachCanonicalState(env.DB, actor, payload);
    return employeeJson(payload, 200, request, env, METHODS);
  } catch (error) {
    return employeeJson({ error: 'Gagal memuat portal', ...publicError(error, crypto.randomUUID()) }, 500, request, env, METHODS);
  }
}

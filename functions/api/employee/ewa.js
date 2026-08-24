import { authenticateEmployee, employeeHandlePreflight, employeeJson, isActiveEmployee, portalMutationAllowed } from '../_employee-auth.js';
import { d1All, d1First, d1Run, hasD1 } from '../_d1.js';
import {
  DEFAULT_EWA_POLICY, earnedDaysInPeriod, ewaEligibility, ewaFee, ewaPlafond,
  payrollStageIndex, policyToRules, tenureDaysFromJoin, tenureMonthsFromJoin,
} from '../_ewa.js';
import { publicError } from '../_security.js';

const METHODS = 'GET, POST, OPTIONS';

async function loadPolicy(database, orgId, clientId) {
  const scoped = await d1First(
    database,
    'SELECT * FROM ewa_policies WHERE org_id=? AND client_id=? LIMIT 1',
    [orgId, clientId],
  );
  if (scoped) return scoped;
  const org = await d1First(
    database,
    'SELECT * FROM ewa_policies WHERE org_id=? AND client_id IS NULL LIMIT 1',
    [orgId],
  );
  return org || { ...DEFAULT_EWA_POLICY, org_id: orgId };
}

async function loadNet(database, employeeId) {
  const line = await d1First(
    database,
    `SELECT l.net_amount, l.components, s.period FROM payroll_run_lines l
      JOIN payroll_submissions s ON s.id=l.submission_id
      WHERE l.employee_id=? AND l.included=1
      ORDER BY s.period DESC, l.updated_at DESC LIMIT 1`,
    [employeeId],
  );
  if (line) return Number(line.net_amount) || 0;
  const compensation = await d1First(
    database,
    'SELECT imported_net, basic_salary FROM employee_compensation WHERE employee_id=? LIMIT 1',
    [employeeId],
  );
  return Number(compensation?.imported_net || compensation?.basic_salary || 0);
}

async function snapshot(database, actor) {
  const orgId = actor.orgId;
  const policy = await loadPolicy(database, orgId, actor.clientId);
  const earned = earnedDaysInPeriod();
  const contract = await d1First(
    database,
    'SELECT join_date, accepted_date FROM employee_contracts WHERE employee_id=? AND is_current=1 LIMIT 1',
    [actor.id],
  );
  const joinDate = contract?.join_date || contract?.accepted_date || '';
  const tenureMonths = tenureMonthsFromJoin(joinDate);
  const tenureDays = tenureDaysFromJoin(joinDate);
  const net = await loadNet(database, actor.id);
  const plafond = ewaPlafond({
    net, daysWorked: earned.daysWorked, daysInMonth: earned.daysInMonth, maxPercent: policy.max_percent,
  });
  const open = await d1First(
    database,
    `SELECT * FROM ewa_requests WHERE employee_id=? AND status IN ('SUBMITTED','APPROVED','DISBURSED','REPAYING')
      ORDER BY created_at DESC LIMIT 1`,
    [actor.id],
  );
  const submission = await d1First(
    database,
    `SELECT s.state, pi.status AS pi_status, r.status AS rec_status
      FROM payroll_submissions s
      LEFT JOIN payment_instructions pi ON pi.submission_id=s.id
      LEFT JOIN reconciliations r ON r.payment_instruction_id=pi.id
      WHERE EXISTS (
        SELECT 1 FROM payroll_run_lines l WHERE l.submission_id=s.id AND l.employee_id=? AND l.included=1
      ) OR EXISTS (
        SELECT 1 FROM payment_instruction_lines pil
        JOIN payment_instructions p2 ON p2.id=pil.payment_instruction_id
        WHERE p2.submission_id=s.id AND pil.employee_id=?
      )
      ORDER BY s.period DESC LIMIT 1`,
    [actor.id, actor.id],
  );
  const stage = submission
    ? payrollStageIndex(submission.state, submission.pi_status, submission.rec_status)
    : 1;
  const paid = stage >= 5;
  const eligibility = ewaEligibility({
    policy, daysWorked: earned.daysWorked, tenureMonths, tenureDays, joinDate,
    plafond, openRequest: open, paid, active: true,
  });
  const history = await d1All(
    database,
    `SELECT id, period, amount, fee, repayment, method, status, created_at, decided_at
      FROM ewa_requests WHERE employee_id=? ORDER BY created_at DESC LIMIT 12`,
    [actor.id],
  );
  return {
    policy, earned, joinDate, tenureMonths, tenureDays, net, plafond, open, paid, eligibility, history, period: earned.period,
  };
}

export async function onRequest({ request, env }) {
  if (request.method === 'OPTIONS') return employeeHandlePreflight(request, env, METHODS);
  if (!['GET', 'POST'].includes(request.method)) {
    return employeeJson({ error: 'Method not allowed' }, 405, request, env, METHODS);
  }
  if (request.method === 'POST' && !portalMutationAllowed(request, env)) {
    return employeeJson({ error: 'Origin not allowed' }, 403, request, env, METHODS);
  }
  if (!hasD1(env)) {
    return employeeJson({ error: 'Cloudflare D1 binding unavailable', code: 'D1_REQUIRED' }, 503, request, env, METHODS);
  }
  const actor = await authenticateEmployee(request, env);
  if (!actor) return employeeJson({ error: 'Sesi tidak valid atau kedaluwarsa.' }, 401, request, env, METHODS);
  if (!isActiveEmployee(actor)) {
    return employeeJson({ error: 'Karyawan tidak aktif' }, 403, request, env, METHODS);
  }

  const respond = (data, status = 200) => employeeJson(data, status, request, env, METHODS);

  try {
    const state = await snapshot(env.DB, actor);
    if (request.method === 'GET') {
      return respond({
        ok: true,
        rules: policyToRules(state.policy),
        emp: {
          daysWorked: state.earned.daysWorked,
          daysInMonth: state.earned.daysInMonth,
          tenureMonths: state.tenureMonths,
          tenureDays: state.tenureDays,
          joinDate: state.joinDate || '',
          net: state.net,
        },
        plafond: state.plafond,
        eligible: state.eligibility.eligible,
        reason: state.eligibility.reason,
        app: state.open || null,
        history: state.history,
      });
    }

    let body;
    try { body = await request.json(); } catch { return respond({ error: 'Invalid JSON' }, 400); }
    const action = String(body.action || 'SUBMIT').toUpperCase();

    if (action === 'CANCEL') {
      if (!state.open || state.open.status !== 'SUBMITTED') {
        return respond({ error: 'Tidak ada pengajuan yang bisa dibatalkan' }, 409);
      }
      await d1Run(
        env.DB,
        `UPDATE ewa_requests SET status='CANCELLED', updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`,
        [state.open.id],
      );
      return respond({ ok: true, cancelled: state.open.id });
    }

    if (actor.mustChangePassword) {
      return respond({ error: 'Ganti password terlebih dahulu' }, 409);
    }
    if (!body.agreed) return respond({ error: 'Persetujuan potongan gaji wajib' }, 422);
    const amount = Math.round(Number(body.amount) || 0);
    if (amount < 100000) return respond({ error: 'Nominal minimal Rp 100.000' }, 422);
    if (!state.eligibility.eligible) return respond({ error: state.eligibility.reason }, 409);
    if (amount > state.plafond) return respond({ error: 'Nominal melebihi plafond' }, 422);

    const fee = ewaFee(amount, state.policy);
    const id = `EWA-${crypto.randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase()}`;
    await d1Run(
      env.DB,
      `INSERT INTO ewa_requests (
        id, org_id, client_id, employee_id, period, amount, fee, repayment, method, tenor_months, status,
        plafond_snapshot, days_worked_snapshot, tenure_months_snapshot, employee_note
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'SUBMITTED', ?, ?, ?, ?)`,
      [
        id, actor.orgId, actor.clientId, actor.id, state.period, amount, fee, amount + fee,
        String(body.method || 'SALARY_ACCOUNT').slice(0, 40), Number(state.policy.max_tenor_months || 1),
        state.plafond, state.earned.daysWorked, state.tenureMonths, String(body.note || '').slice(0, 240) || null,
      ],
    );
    await d1Run(
      env.DB,
      `INSERT INTO audit_logs (id, org_id, username, role, action, detail, entity, entity_id)
        VALUES (?, ?, ?, 'EMPLOYEE', 'EWA_SUBMITTED', ?, 'ewa_request', ?)`,
      [`AUD-${crypto.randomUUID()}`, actor.orgId, actor.employeeCode, `${id} · ${amount}`, id],
    );
    const created = await d1First(env.DB, 'SELECT * FROM ewa_requests WHERE id=?', [id]);
    return respond({ ok: true, request: created });
  } catch (error) {
    if (String(error?.message || '').includes('idx_ewa_one_open')) {
      return respond({ error: 'Masih ada pengajuan yang berjalan' }, 409);
    }
    return respond({ error: 'EWA request failed', ...publicError(error, crypto.randomUUID()) }, 500);
  }
}

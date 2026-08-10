import { neon } from '@neondatabase/serverless';
import {
  authorize, enforceRateLimit, handlePreflight, publicError, secureJson,
} from './_security.js';
import {
  canTransition, instructionTotal, validateOperatingAction,
} from './operating-model-validation.js';

const METHODS = 'GET, POST, OPTIONS';
const READ_ROLES = ['SUPER_ADMIN','PAYROLL_PROCESSOR','PAYROLL_CONTROLLER','CLIENT_USER','PAYROLL','FINANCE','DIRECTOR'];
const WRITE_ROLES = ['SUPER_ADMIN','PAYROLL_PROCESSOR','PAYROLL_CONTROLLER','CLIENT_USER','PAYROLL','FINANCE','DIRECTOR'];
const PROCESSOR_ROLES = new Set(['SUPER_ADMIN','PAYROLL_PROCESSOR','PAYROLL']);
const CONTROLLER_ROLES = new Set(['SUPER_ADMIN','PAYROLL_CONTROLLER','FINANCE','DIRECTOR']);
const CLIENT_ROLES = new Set(['CLIENT_USER']);

function databaseUrl(env) {
  return env.DATABASE_URL || env.NEON_DATABASE_URL || env.POSTGRES_URL || null;
}

function orgId(env) {
  return String(env.DEFAULT_ORG_ID || 'ORG-OTSINDO');
}

function clientScope(actor, env) {
  if (actor.role !== 'CLIENT_USER') return null;
  try {
    const map = JSON.parse(env.CLIENT_SCOPE_JSON || '{}');
    const value = map[String(actor.email || '').toLowerCase()];
    return new Set(Array.isArray(value) ? value.map(String) : []);
  } catch {
    return new Set();
  }
}

function assertClientScope(actor, env, clientId) {
  const scope = clientScope(actor, env);
  return !scope || scope.has(String(clientId));
}

function roleAllowsTransition(role, from, to) {
  if (CLIENT_ROLES.has(role)) return from === 'DRAFT' && to === 'SUBMITTED'
    || from === 'CLIENT_ACTION_REQUIRED' && to === 'CLIENT_RESUBMITTED';
  if (CONTROLLER_ROLES.has(role)) {
    return ['CONTROLLER_REVIEW','DATA_APPROVED','PAYROLL_FINALIZED','PAYMENT_INSTRUCTION_READY',
      'PAYMENT_APPROVAL_PENDING','APPROVED_FOR_PAYMENT','DISBURSEMENT_PROCESSING',
      'PROOF_UPLOADED','RECONCILIATION','PAYMENT_EXCEPTION'].includes(from);
  }
  return PROCESSOR_ROLES.has(role);
}

async function parseBody(request) {
  const length = Number(request.headers.get('content-length') || 0);
  if (length > 2 * 1024 * 1024) throw new Error('PAYLOAD_TOO_LARGE');
  return request.json();
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return handlePreflight(request, env, METHODS);
  if (!['GET', 'POST'].includes(request.method)) {
    return secureJson({ error: 'Method not allowed' }, 405, request, env, METHODS);
  }

  const authorization = await authorize(request, env, {
    roles: request.method === 'GET' ? READ_ROLES : WRITE_ROLES,
    mutating: request.method === 'POST',
    methods: METHODS,
  });
  if (authorization.response) return authorization.response;
  const limited = await enforceRateLimit(request, env, authorization.actor, 'operating-model', METHODS);
  if (limited) return limited;

  const respond = (data, status = 200) => secureJson(data, status, request, env, METHODS);
  const requestId = crypto.randomUUID();
  const url = databaseUrl(env);
  if (!url) return respond({ error: 'Service unavailable', requestId }, 503);
  const sql = neon(url);
  const actor = authorization.actor;
  const organizationId = orgId(env);

  try {
    if (request.method === 'GET') {
      const params = new URL(request.url).searchParams;
      const resource = params.get('resource') || 'submissions';
      const clientId = params.get('clientId');
      if (actor.role === 'CLIENT_USER' && (!clientId || !assertClientScope(actor, env, clientId))) {
        return respond({ error: 'Client scope required' }, 403);
      }
      if (resource === 'service-plans') {
        const rows = clientId
          ? await sql`SELECT * FROM client_service_plans WHERE client_id = ${clientId} ORDER BY effective_from DESC LIMIT 100`
          : await sql`SELECT sp.* FROM client_service_plans sp JOIN clients c ON c.id=sp.client_id WHERE c.org_id=${organizationId} ORDER BY sp.effective_from DESC LIMIT 100`;
        return respond({ ok: true, servicePlans: rows });
      }
      if (resource === 'exceptions') {
        const rows = clientId
          ? await sql`SELECT e.* FROM payroll_exceptions e JOIN payroll_submissions s ON s.id=e.submission_id WHERE s.org_id=${organizationId} AND s.client_id=${clientId} ORDER BY e.created_at DESC LIMIT 500`
          : await sql`SELECT e.* FROM payroll_exceptions e JOIN payroll_submissions s ON s.id=e.submission_id WHERE s.org_id=${organizationId} ORDER BY e.created_at DESC LIMIT 500`;
        return respond({ ok: true, exceptions: rows });
      }
      if (resource === 'payment-instructions') {
        const rows = clientId
          ? await sql`SELECT * FROM payment_instructions WHERE org_id=${organizationId} AND client_id=${clientId} ORDER BY created_at DESC LIMIT 100`
          : await sql`SELECT * FROM payment_instructions WHERE org_id=${organizationId} ORDER BY created_at DESC LIMIT 100`;
        return respond({ ok: true, paymentInstructions: rows });
      }
      const rows = clientId
        ? await sql`SELECT * FROM payroll_submissions WHERE org_id=${organizationId} AND client_id=${clientId} ORDER BY created_at DESC LIMIT 200`
        : await sql`SELECT * FROM payroll_submissions WHERE org_id=${organizationId} ORDER BY created_at DESC LIMIT 200`;
      return respond({ ok: true, submissions: rows });
    }

    let body;
    try {
      body = await parseBody(request);
    } catch (error) {
      return respond({ error: error.message === 'PAYLOAD_TOO_LARGE' ? 'Payload too large' : 'Invalid JSON' }, error.message === 'PAYLOAD_TOO_LARGE' ? 413 : 400);
    }
    const validation = validateOperatingAction(body);
    if (!validation.ok) return respond({ error: validation.errors.join('; ') }, 422);

    if (body.action === 'CREATE_SERVICE_PLAN') {
      if (!PROCESSOR_ROLES.has(actor.role)) return respond({ error: 'Insufficient role' }, 403);
      const client = await sql`SELECT id FROM clients WHERE id=${body.clientId} AND org_id=${organizationId} LIMIT 1`;
      if (!client.length) return respond({ error: 'Client not found' }, 404);
      const overlap = await sql`
        SELECT id FROM client_service_plans
        WHERE client_id=${body.clientId} AND status='ACTIVE'
          AND effective_from <= COALESCE(${body.effectiveUntil || null}::date, 'infinity'::date)
          AND COALESCE(effective_until, 'infinity'::date) >= ${body.effectiveFrom}::date
        LIMIT 1`;
      if (overlap.length) return respond({ error: 'Service plan effective period overlaps an active plan', conflictingPlanId: overlap[0].id }, 409);
      const id = body.id || `SP-${crypto.randomUUID()}`;
      const result = await sql`
        INSERT INTO client_service_plans
          (id, client_id, tier, status, contract_reference, effective_from, effective_until, created_by)
        VALUES
          (${id}, ${body.clientId}, ${body.tier}, 'ACTIVE', ${body.contractReference || null},
           ${body.effectiveFrom}, ${body.effectiveUntil || null}, ${actor.email})
        RETURNING *`;
      return respond({ ok: true, servicePlan: result[0] }, 201);
    }

    if (body.action === 'CREATE_SUBMISSION') {
      if (!assertClientScope(actor, env, body.clientId)) return respond({ error: 'Client scope denied' }, 403);
      const plan = await sql`
        SELECT sp.* FROM client_service_plans sp JOIN clients c ON c.id=sp.client_id
        WHERE sp.id=${body.servicePlanId} AND sp.client_id=${body.clientId}
          AND c.org_id=${organizationId} AND sp.status='ACTIVE'
          AND sp.effective_from <= CURRENT_DATE
          AND (sp.effective_until IS NULL OR sp.effective_until >= CURRENT_DATE)
        LIMIT 1`;
      if (!plan.length) return respond({ error: 'Active service plan not found' }, 409);
      const id = body.id || `SUB-${crypto.randomUUID()}`;
      const rows = await sql`
        INSERT INTO payroll_submissions
          (id, org_id, client_id, service_plan_id, service_tier, period, state, created_by)
        VALUES
          (${id}, ${organizationId}, ${body.clientId}, ${body.servicePlanId}, ${plan[0].tier},
           ${body.period}, 'DRAFT', ${actor.email})
        RETURNING *`;
      return respond({ ok: true, submission: rows[0] }, 201);
    }

    if (body.action === 'TRANSITION_SUBMISSION') {
      const current = await sql`SELECT * FROM payroll_submissions WHERE id=${body.submissionId} AND org_id=${organizationId} LIMIT 1`;
      if (!current.length) return respond({ error: 'Submission not found' }, 404);
      const submission = current[0];
      if (!assertClientScope(actor, env, submission.client_id)) return respond({ error: 'Client scope denied' }, 403);
      if (!canTransition(submission.state, body.toState)) return respond({ error: `Invalid transition ${submission.state} → ${body.toState}` }, 409);
      if (submission.service_tier === 'TIER_1_PAYMENT_PROCESSING' && ['INGESTING','PAYROLL_FINALIZED'].includes(body.toState)) {
        return respond({ error: 'Tier 1 does not include payroll ingestion or calculation' }, 409);
      }
      if (!roleAllowsTransition(actor.role, submission.state, body.toState)) return respond({ error: 'Role cannot perform transition' }, 403);
      if (['VALIDATED','DATA_APPROVED','PAYROLL_FINALIZED','APPROVED_FOR_PAYMENT'].includes(body.toState)) {
        const blocking = await sql`
          SELECT COUNT(*)::int AS count FROM payroll_exceptions
          WHERE submission_id=${submission.id} AND severity='CRITICAL'
            AND status NOT IN ('ACCEPTED','RESOLVED','AUTO_NORMALIZED')`;
        if (Number(blocking[0]?.count || 0) > 0) return respond({ error: 'Critical exceptions still open' }, 409);
      }
      const rows = await sql`UPDATE payroll_submissions SET state=${body.toState}, updated_at=NOW() WHERE id=${submission.id} RETURNING *`;
      await sql`INSERT INTO audit_logs (id, org_id, username, role, action, detail, entity, entity_id)
        VALUES (${`AUD-${crypto.randomUUID()}`}, ${organizationId}, ${actor.email}, ${actor.role},
          'SUBMISSION_TRANSITION', ${`${submission.state} → ${body.toState}`}, 'payroll_submission', ${submission.id})`;
      return respond({ ok: true, submission: rows[0] });
    }

    if (body.action === 'CREATE_EXCEPTION') {
      if (!PROCESSOR_ROLES.has(actor.role)) return respond({ error: 'Insufficient role' }, 403);
      const submission = await sql`SELECT id, client_id FROM payroll_submissions WHERE id=${body.submissionId} AND org_id=${organizationId} LIMIT 1`;
      if (!submission.length) return respond({ error: 'Submission not found' }, 404);
      const id = body.id || `EXC-${crypto.randomUUID()}`;
      const rows = await sql`
        INSERT INTO payroll_exceptions
          (id, submission_id, employee_id, field, category, severity, source_value,
           canonical_value, suggested_value, reason, confidence, owner, status)
        VALUES
          (${id}, ${body.submissionId}, ${body.employeeId || null}, ${body.field || null},
           ${body.category}, ${body.severity}, ${JSON.stringify(body.sourceValue ?? null)}::jsonb,
           ${JSON.stringify(body.canonicalValue ?? null)}::jsonb, ${JSON.stringify(body.suggestedValue ?? null)}::jsonb,
           ${body.reason || null}, ${body.confidence ?? null}, ${body.owner || actor.email}, 'OPEN')
        RETURNING *`;
      return respond({ ok: true, exception: rows[0] }, 201);
    }

    if (body.action === 'RESOLVE_EXCEPTION') {
      const current = await sql`
        SELECT e.*, s.client_id FROM payroll_exceptions e
        JOIN payroll_submissions s ON s.id=e.submission_id
        WHERE e.id=${body.exceptionId} AND s.org_id=${organizationId} LIMIT 1`;
      if (!current.length) return respond({ error: 'Exception not found' }, 404);
      if (!assertClientScope(actor, env, current[0].client_id)) return respond({ error: 'Client scope denied' }, 403);
      const rows = await sql`
        UPDATE payroll_exceptions SET status=${body.status}, resolution_note=${body.resolutionNote},
          resolved_at=NOW(), resolved_by=${actor.email} WHERE id=${body.exceptionId} RETURNING *`;
      return respond({ ok: true, exception: rows[0] });
    }

    if (body.action === 'CREATE_PAYMENT_INSTRUCTION') {
      if (!CONTROLLER_ROLES.has(actor.role)) return respond({ error: 'Insufficient role' }, 403);
      const total = instructionTotal(body.lines);
      if (total !== body.expectedTotal) return respond({ error: 'Payment instruction total does not match approved total', expected: body.expectedTotal, actual: total }, 409);
      const existing = await sql`SELECT * FROM payment_instructions WHERE idempotency_key=${body.idempotencyKey} LIMIT 1`;
      if (existing.length) return respond({ ok: true, paymentInstruction: existing[0], idempotentReplay: true });
      const id = body.id || `PI-${crypto.randomUUID()}`;
      await sql.transaction((tx) => {
        const queries = [tx`
          INSERT INTO payment_instructions
            (id, org_id, client_id, submission_id, payroll_id, status, expected_total, creator_user_id, idempotency_key)
          VALUES
            (${id}, ${organizationId}, ${body.clientId}, ${body.submissionId || null}, ${body.payrollId || null},
             'PAYMENT_APPROVAL_PENDING', ${body.expectedTotal}, ${actor.id}, ${body.idempotencyKey})`];
        body.lines.forEach((line) => queries.push(tx`
          INSERT INTO payment_instruction_lines
            (id, payment_instruction_id, employee_id, beneficiary_name, bank_name, masked_account, amount)
          VALUES
            (${line.id || `PIL-${crypto.randomUUID()}`}, ${id}, ${line.employeeId || null},
             ${line.beneficiaryName}, ${line.bankName}, ${line.maskedAccount}, ${line.amount})`));
        return queries;
      });
      const rows = await sql`SELECT * FROM payment_instructions WHERE id=${id}`;
      return respond({ ok: true, paymentInstruction: rows[0] }, 201);
    }

    if (body.action === 'APPROVE_PAYMENT') {
      if (!CONTROLLER_ROLES.has(actor.role)) return respond({ error: 'Insufficient role' }, 403);
      const rows = await sql`
        SELECT pi.*, COALESCE(SUM(pil.amount),0)::bigint AS instruction_total
        FROM payment_instructions pi LEFT JOIN payment_instruction_lines pil ON pil.payment_instruction_id=pi.id
        WHERE pi.id=${body.paymentInstructionId} AND pi.org_id=${organizationId}
        GROUP BY pi.id LIMIT 1`;
      if (!rows.length) return respond({ error: 'Payment instruction not found' }, 404);
      const payment = rows[0];
      if (String(payment.creator_user_id) === String(actor.id)) return respond({ error: 'Maker cannot approve the same payment instruction' }, 409);
      if (Number(payment.instruction_total) !== Number(payment.expected_total)) return respond({ error: 'Payment total mismatch blocks approval' }, 409);
      const existing = await sql`SELECT * FROM payment_approvals WHERE payment_instruction_id=${payment.id} AND action_hash=${body.actionHash} LIMIT 1`;
      if (existing.length) return respond({ ok: true, approval: existing[0], idempotentReplay: true });
      const approvalId = `PA-${crypto.randomUUID()}`;
      await sql.transaction((tx) => [
        tx`INSERT INTO payment_approvals (id, payment_instruction_id, approver_user_id, status, action_hash)
          VALUES (${approvalId}, ${payment.id}, ${actor.id}, 'APPROVED', ${body.actionHash})`,
        tx`UPDATE payment_instructions SET status='APPROVED_FOR_PAYMENT', updated_at=NOW() WHERE id=${payment.id}`,
        tx`INSERT INTO audit_logs (id, org_id, username, role, action, detail, entity, entity_id)
          VALUES (${`AUD-${crypto.randomUUID()}`}, ${organizationId}, ${actor.email}, ${actor.role},
            'PAYMENT_APPROVED', 'Maker-checker approval passed', 'payment_instruction', ${payment.id})`,
      ]);
      return respond({ ok: true, approval: { id: approvalId, paymentInstructionId: payment.id, status: 'APPROVED' } });
    }

    return respond({ error: 'Action not implemented' }, 422);
  } catch (error) {
    return respond(publicError(error, requestId), 500);
  }
}

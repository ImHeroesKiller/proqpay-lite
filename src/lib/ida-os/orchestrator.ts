import type {
  ActionRisk,
  ExecutionPlan,
  OrchestrationResult,
  SharedContext,
  WorkerId,
} from './contracts';
import { validateWorkerTask } from './worker-registry';

type IntentRoute = {
  intent: string;
  worker: WorkerId;
  capability: string;
  risk: ActionRisk;
  confirmationPhrase?: string;
};

type IntentPlan = { intent: string; routes: IntentRoute[] };

const ROUTES: Array<{ match: RegExp; route: IntentRoute }> = [
  { match: /\b(endpoint|kolom|field|akses data|data apa|baca database|datasheet|knowledge|pengetahuan data)\b/, route: { intent: 'READ_DATA_CATALOG', worker: 'HR', capability: 'analyze_employee', risk: 'READ' } },
  { match: /\b(hapus|delete|reset)\b/, route: { intent: 'DELETE_DATA', worker: 'HR', capability: 'update_employee', risk: 'DESTRUCTIVE', confirmationPhrase: 'KONFIRMASI HAPUS' } },
  { match: /\b(import|unggah|upload|excel|csv|pdf)\b/, route: { intent: 'READ_DOCUMENT', worker: 'DOCUMENT', capability: 'generate_import_preview', risk: 'READ' } },
  { match: /\b(payment instruction|instruksi pembayaran)\b/, route: { intent: 'GENERATE_PAYMENT_INSTRUCTION', worker: 'OPERATIONS', capability: 'generate_payment_instruction', risk: 'FINANCIAL', confirmationPhrase: 'KONFIRMASI PAYMENT' } },
  { match: /\b(invoice|tagihan)\b.*\b(buat|generate|terbit)\b|\b(buat|generate|terbit)\b.*\b(invoice|tagihan)\b/, route: { intent: 'GENERATE_INVOICE', worker: 'OPERATIONS', capability: 'generate_invoice', risk: 'FINANCIAL', confirmationPhrase: 'KONFIRMASI INVOICE' } },
  { match: /\b(approval|approve|approved|setujui)\b/, route: { intent: 'APPROVE_PAYROLL', worker: 'PAYROLL', capability: 'read_payroll', risk: 'FINANCIAL', confirmationPhrase: 'KONFIRMASI APPROVAL' } },
  { match: /\b(hitung|buat|generate)\b.*\b(payroll|gaji)\b|\bpayroll\b.*\b(hitung|buat|generate)\b/, route: { intent: 'CALCULATE_PAYROLL', worker: 'PAYROLL', capability: 'calculate_payroll', risk: 'FINANCIAL', confirmationPhrase: 'KONFIRMASI PAYROLL' } },
  { match: /\b(payroll|gaji)\b.*\b(ready|siap|rincian|detail|tabel|terendah|tertinggi|paling kecil|paling besar)\b|\b(rincian|detail|tabel|terendah|tertinggi|paling kecil|paling besar)\b.*\b(payroll|gaji|karyawan)\b/, route: { intent: 'READ_PAYROLL_DETAIL', worker: 'PAYROLL', capability: 'read_payroll', risk: 'READ' } },
  { match: /\b(validasi|compliance|regulasi|umr|umk|bpjs|pph21)\b/, route: { intent: 'VALIDATE_COMPLIANCE', worker: 'COMPLIANCE', capability: 'validate_compliance', risk: 'READ' } },
  { match: /\b(karyawan|pegawai|employee|kontrak|resign|rekening|nama mirip|nama sama)\b/, route: { intent: 'MANAGE_EMPLOYEE', worker: 'HR', capability: 'analyze_employee', risk: 'READ' } },
  { match: /\b(client|klien|project|proyek|margin)\b/, route: { intent: 'READ_OPERATIONS', worker: 'OPERATIONS', capability: 'read_client', risk: 'READ' } },
  { match: /\b(ar|piutang|cashflow|rekonsiliasi|outstanding)\b/, route: { intent: 'READ_FINANCE', worker: 'FINANCE', capability: 'read_ar', risk: 'READ' } },
];

function routeIntent(text: string): IntentPlan {
  const normalized = text.toLowerCase().trim();
  if (/\b(revenue|pendapatan)\b/.test(normalized) && /\b(payroll|gaji|indomarco)\b/.test(normalized)) {
    return { intent: 'EXPLAIN_PAYROLL_REVENUE', routes: [
      { intent: 'READ_PAYROLL_DETAIL', worker: 'PAYROLL', capability: 'read_payroll', risk: 'READ' },
      { intent: 'READ_BILLING_RULE', worker: 'OPERATIONS', capability: 'read_billing_rule', risk: 'READ' },
    ] };
  }
  const route = ROUTES.find(({ match }) => match.test(normalized))?.route || {
    intent: 'GENERAL_ASSISTANCE',
    worker: 'PAYROLL',
    capability: 'read_payroll',
    risk: 'READ',
  };
  return { intent: route.intent, routes: [route] };
}

function stablePlanId(context: SharedContext, intent: string, objective: string) {
  const key = [
    context.organization.id || context.organization.name,
    context.currentUser.id || context.currentUser.email,
    context.payrollPeriod || '-',
    intent,
    objective.toLowerCase().replace(/\s+/g, ' ').trim(),
  ].join('|');
  let hash = 2166136261;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `PLAN-${(hash >>> 0).toString(16).toUpperCase()}`;
}

export function orchestrateRequest(text: string, context: SharedContext): OrchestrationResult {
  const routed = routeIntent(text);
  const permissions = routed.routes.map((route) => validateWorkerTask(route.worker, route.capability, context.currentRole, route.risk));
  const blockers = permissions.flatMap((permission) => permission.blockers);
  const planId = stablePlanId(context, routed.intent, text);
  const risk = routed.routes.some((route) => route.risk === 'DESTRUCTIVE') ? 'DESTRUCTIVE'
    : routed.routes.some((route) => route.risk === 'FINANCIAL') ? 'FINANCIAL'
    : routed.routes.some((route) => route.risk === 'WRITE') ? 'WRITE' : 'READ';
  const requiresConfirmation = risk !== 'READ';
  const confirmationPhrase = routed.routes.find((route) => route.confirmationPhrase)?.confirmationPhrase;
  const plan: ExecutionPlan = {
    id: planId,
    intent: routed.intent,
    objective: text.trim(),
    stage: blockers.length === 0 ? (requiresConfirmation ? 'PREVIEW' : 'DELEGATE') : 'BLOCKED',
    tasks: routed.routes.map((route, index) => ({
      id: `${planId}-${index + 1}`,
      worker: route.worker, capability: route.capability, objective: text.trim(), risk: route.risk,
      context,
      input: {},
    })),
    risk,
    requiresConfirmation,
    confirmationPhrase,
    affectedRecords: [],
    createdAt: Date.now(),
  };
  return { plan, allowed: blockers.length === 0, blockers };
}

export function buildSharedContext(db: any, overrides: Partial<SharedContext> = {}): SharedContext {
  const period = db?.meta?.currentPeriod || new Date().toISOString().slice(0, 7);
  const payroll = (db?.payrolls || []).find((item: any) => item.period === period);
  return {
    organization: { name: db?.meta?.orgName || 'ProQPay Lite' },
    currentUser: { email: 'anonymous@unauthenticated' },
    currentRole: 'VIEWER',
    conversation: {},
    currentClient: undefined,
    currentProject: undefined,
    payrollPeriod: period,
    currentPayrollRun: payroll ? { id: payroll.id, status: payroll.status } : undefined,
    permissions: [],
    language: 'id',
    timezone: 'Asia/Jakarta',
    ...overrides,
  };
}

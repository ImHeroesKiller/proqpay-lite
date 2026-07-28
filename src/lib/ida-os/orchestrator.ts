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

const ROUTES: Array<{ match: RegExp; route: IntentRoute }> = [
  { match: /\b(hapus|delete|reset)\b/, route: { intent: 'DELETE_DATA', worker: 'HR', capability: 'update_employee', risk: 'DESTRUCTIVE', confirmationPhrase: 'KONFIRMASI HAPUS' } },
  { match: /\b(import|unggah|upload|excel|csv|pdf)\b/, route: { intent: 'READ_DOCUMENT', worker: 'DOCUMENT', capability: 'generate_import_preview', risk: 'READ' } },
  { match: /\b(payment instruction|instruksi pembayaran)\b/, route: { intent: 'GENERATE_PAYMENT_INSTRUCTION', worker: 'OPERATIONS', capability: 'generate_payment_instruction', risk: 'FINANCIAL', confirmationPhrase: 'KONFIRMASI PAYMENT' } },
  { match: /\b(invoice|tagihan)\b.*\b(buat|generate|terbit)\b|\b(buat|generate|terbit)\b.*\b(invoice|tagihan)\b/, route: { intent: 'GENERATE_INVOICE', worker: 'OPERATIONS', capability: 'generate_invoice', risk: 'FINANCIAL', confirmationPhrase: 'KONFIRMASI INVOICE' } },
  { match: /\b(approval|approve|approved|setujui)\b/, route: { intent: 'APPROVE_PAYROLL', worker: 'PAYROLL', capability: 'read_payroll', risk: 'FINANCIAL', confirmationPhrase: 'KONFIRMASI APPROVAL' } },
  { match: /\b(hitung|buat|generate)\b.*\b(payroll|gaji)\b|\bpayroll\b.*\b(hitung|buat|generate)\b/, route: { intent: 'CALCULATE_PAYROLL', worker: 'PAYROLL', capability: 'calculate_payroll', risk: 'FINANCIAL', confirmationPhrase: 'KONFIRMASI PAYROLL' } },
  { match: /\b(validasi|compliance|regulasi|umr|umk|bpjs|pph21)\b/, route: { intent: 'VALIDATE_COMPLIANCE', worker: 'COMPLIANCE', capability: 'validate_compliance', risk: 'READ' } },
  { match: /\b(karyawan|pegawai|employee|kontrak|resign)\b/, route: { intent: 'MANAGE_EMPLOYEE', worker: 'HR', capability: 'analyze_employee', risk: 'READ' } },
  { match: /\b(client|klien|project|proyek|margin)\b/, route: { intent: 'READ_OPERATIONS', worker: 'OPERATIONS', capability: 'read_client', risk: 'READ' } },
  { match: /\b(ar|piutang|cashflow|rekonsiliasi|outstanding)\b/, route: { intent: 'READ_FINANCE', worker: 'FINANCE', capability: 'read_ar', risk: 'READ' } },
];

function routeIntent(text: string): IntentRoute {
  const normalized = text.toLowerCase().trim();
  return ROUTES.find(({ match }) => match.test(normalized))?.route || {
    intent: 'GENERAL_ASSISTANCE',
    worker: 'PAYROLL',
    capability: 'read_payroll',
    risk: 'READ',
  };
}

function stablePlanId(context: SharedContext, route: IntentRoute, objective: string) {
  const key = [
    context.organization.id || context.organization.name,
    context.currentUser.id || context.currentUser.email,
    context.payrollPeriod || '-',
    route.intent,
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
  const route = routeIntent(text);
  const permission = validateWorkerTask(route.worker, route.capability, context.currentRole, route.risk);
  const planId = stablePlanId(context, route, text);
  const requiresConfirmation = route.risk !== 'READ';
  const plan: ExecutionPlan = {
    id: planId,
    intent: route.intent,
    objective: text.trim(),
    stage: permission.allowed ? (requiresConfirmation ? 'PREVIEW' : 'DELEGATE') : 'BLOCKED',
    tasks: [{
      id: `${planId}-1`,
      worker: route.worker,
      capability: route.capability,
      objective: text.trim(),
      risk: route.risk,
      context,
      input: {},
    }],
    risk: route.risk,
    requiresConfirmation,
    confirmationPhrase: route.confirmationPhrase,
    affectedRecords: [],
    createdAt: Date.now(),
  };
  return { plan, allowed: permission.allowed, blockers: permission.blockers };
}

export function buildSharedContext(db: any, overrides: Partial<SharedContext> = {}): SharedContext {
  const period = db?.meta?.currentPeriod || new Date().toISOString().slice(0, 7);
  const payroll = (db?.payrolls || []).find((item: any) => item.period === period);
  return {
    organization: { name: db?.meta?.orgName || 'ProQPay Lite' },
    currentUser: { email: 'local@proqpay' },
    currentRole: 'SUPER_ADMIN',
    conversation: {},
    currentClient: undefined,
    currentProject: undefined,
    payrollPeriod: period,
    currentPayrollRun: payroll ? { id: payroll.id, status: payroll.status } : undefined,
    permissions: ['*'],
    language: 'id',
    timezone: 'Asia/Jakarta',
    ...overrides,
  };
}

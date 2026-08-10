import type { ActionRisk, IdaRole, WorkerId } from './contracts';

export type WorkerPolicy = {
  id: WorkerId;
  label: string;
  capabilities: readonly string[];
  tables: readonly string[];
  forbidden: readonly string[];
  roles: readonly IdaRole[];
};

export const WORKER_REGISTRY: Record<WorkerId, WorkerPolicy> = {
  PAYROLL: {
    id: 'PAYROLL',
    label: 'Payroll Staff',
    capabilities: ['read_payroll', 'calculate_payroll', 'validate_payroll', 'reconcile_payroll', 'explain_payroll'],
    tables: ['payrolls', 'payroll_lines', 'payroll_rules', 'payroll_setups'],
    forbidden: ['generate_invoice', 'mutate_employee', 'execute_payment'],
    roles: ['SUPER_ADMIN', 'PAYROLL_PROCESSOR', 'PAYROLL_CONTROLLER', 'PAYROLL', 'DIRECTOR', 'FINANCE', 'VIEWER'],
  },
  HR: {
    id: 'HR',
    label: 'HR Staff',
    capabilities: ['find_employee', 'analyze_employee', 'update_employee', 'manage_contract', 'summarize_attendance'],
    tables: ['employees', 'employee_contracts', 'employee_assignments', 'employee_compensations', 'attendance'],
    forbidden: ['calculate_payroll', 'generate_invoice', 'execute_payment'],
    roles: ['SUPER_ADMIN', 'PAYROLL_PROCESSOR', 'PAYROLL_CONTROLLER', 'CLIENT_USER', 'HR', 'PAYROLL', 'VIEWER'],
  },
  OPERATIONS: {
    id: 'OPERATIONS',
    label: 'Operations Staff',
    capabilities: ['read_client', 'read_project', 'read_billing_rule', 'generate_invoice', 'generate_payment_instruction', 'calculate_margin'],
    tables: ['clients', 'projects', 'billing_rules', 'invoices', 'payments'],
    forbidden: ['mutate_employee', 'calculate_payroll'],
    roles: ['SUPER_ADMIN', 'PAYROLL_PROCESSOR', 'PAYROLL_CONTROLLER', 'CLIENT_USER', 'PAYROLL', 'DIRECTOR', 'FINANCE', 'VIEWER'],
  },
  COMPLIANCE: {
    id: 'COMPLIANCE',
    label: 'Compliance Staff',
    capabilities: ['validate_compliance', 'explain_regulation', 'analyze_risk'],
    tables: ['provinces', 'regulatory_knowledge'],
    forbidden: ['mutate_payroll', 'mutate_employee', 'execute_payment'],
    roles: ['SUPER_ADMIN', 'PAYROLL_PROCESSOR', 'PAYROLL_CONTROLLER', 'CLIENT_USER', 'HR', 'PAYROLL', 'DIRECTOR', 'FINANCE', 'VIEWER'],
  },
  DOCUMENT: {
    id: 'DOCUMENT',
    label: 'Document Staff',
    capabilities: ['read_document', 'detect_template', 'map_columns', 'score_confidence', 'generate_import_preview'],
    tables: [],
    forbidden: ['mutate_database', 'calculate_payroll', 'execute_payment'],
    roles: ['SUPER_ADMIN', 'PAYROLL_PROCESSOR', 'CLIENT_USER', 'HR', 'PAYROLL'],
  },
  FINANCE: {
    id: 'FINANCE',
    label: 'Finance Staff',
    capabilities: ['read_ar', 'read_ap', 'analyze_cashflow', 'reconcile_payment', 'analyze_margin', 'forecast'],
    tables: ['ar_monitor', 'invoices', 'payments'],
    forbidden: ['mutate_employee'],
    roles: ['SUPER_ADMIN', 'PAYROLL_CONTROLLER', 'FINANCE', 'DIRECTOR', 'VIEWER'],
  },
};

const RISK_ROLES: Record<ActionRisk, readonly IdaRole[]> = {
  READ: ['SUPER_ADMIN', 'PAYROLL_PROCESSOR', 'PAYROLL_CONTROLLER', 'CLIENT_USER', 'HR', 'PAYROLL', 'DIRECTOR', 'FINANCE', 'VIEWER'],
  WRITE: ['SUPER_ADMIN', 'PAYROLL_PROCESSOR', 'PAYROLL_CONTROLLER', 'CLIENT_USER', 'HR', 'PAYROLL', 'FINANCE'],
  FINANCIAL: ['SUPER_ADMIN', 'PAYROLL_CONTROLLER', 'PAYROLL', 'DIRECTOR', 'FINANCE'],
  DESTRUCTIVE: ['SUPER_ADMIN'],
};

export function validateWorkerTask(
  worker: WorkerId,
  capability: string,
  role: IdaRole,
  risk: ActionRisk
) {
  const policy = WORKER_REGISTRY[worker];
  const blockers: string[] = [];
  if (!policy.capabilities.includes(capability)) {
    blockers.push(`${policy.label} tidak memiliki capability ${capability}.`);
  }
  if (!policy.roles.includes(role)) {
    blockers.push(`Role ${role} tidak boleh menggunakan ${policy.label}.`);
  }
  if (!RISK_ROLES[risk].includes(role)) {
    blockers.push(`Role ${role} tidak boleh menjalankan aksi ${risk}.`);
  }
  return { allowed: blockers.length === 0, blockers };
}

export function assertWorkerTableAccess(worker: WorkerId, tables: string[]) {
  const policy = WORKER_REGISTRY[worker];
  const denied = tables.filter((table) => !policy.tables.includes(table));
  return {
    allowed: denied.length === 0,
    denied,
    blockers: denied.map((table) => `${policy.label} tidak boleh mengakses tabel ${table}.`),
  };
}

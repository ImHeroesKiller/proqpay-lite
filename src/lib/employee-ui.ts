export type EmployeeActor = {
  role: string;
  email?: string;
  permissions?: string[];
};

export type EmployeeRecord = {
  id: string;
  employeeCode?: string | null;
  clientId?: string | null;
  projectId?: string | null;
  company?: string | null;
  project?: string | null;
  position?: string | null;
  name?: string | null;
  status?: string | null;
  isActive?: boolean;
  employmentType?: string | null;
  joinDate?: string | null;
  contractStart?: string | null;
  contractEnd?: string | null;
  resignDate?: string | null;
  resignReason?: string | null;
  region?: string | null;
  province?: string | null;
  salaryGross?: number | null;
  nik?: string | null;
  npwp?: string | null;
  accountNo?: string | null;
  bankAccount?: string | null;
  bankName?: string | null;
  bpjsKesehatanNo?: string | null;
  jamsostekNo?: string | null;
  email?: string | null;
  phone?: string | null;
  mobile?: string | null;
  address?: string | null;
  [key: string]: unknown;
};

export type EmployeeAdminForm = {
  nik: string;
  email: string;
  bankName: string;
  accountNo: string;
  bpjsKesehatanNo: string;
  jamsostekNo: string;
};

export type PortalCredentialRow = {
  employeeId: string;
  employeeCode: string;
  name: string;
  projectCode: string;
  password: string;
  scheme?: string;
};

export type PortalCredentialSummary = {
  total: number;
  issued: number;
  pending: number;
  formula?: string;
};

export function employeeText(value: unknown) {
  return String(value ?? '').trim();
}

export function employeeDateLabel(value: unknown) {
  if (!value) return '-';
  const timestamp = Date.parse(String(value));
  if (!Number.isFinite(timestamp)) return '-';
  return new Intl.DateTimeFormat('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(timestamp));
}

export function employeeIssues(employee: EmployeeRecord) {
  const issues: string[] = [];
  if (!employeeText(employee.accountNo || employee.bankAccount)) issues.push('Rekening');
  if (!employeeText(employee.nik)) issues.push('NIK');
  if (!employeeText(employee.bpjsKesehatanNo)) issues.push('BPJS Kes');
  if (!employeeText(employee.jamsostekNo)) issues.push('BPJS TK');
  return issues;
}

export function employeeStatusTone(status: unknown) {
  const value = employeeText(status).toLowerCase();
  if (/habis|expired|resign|non[ -]?aktif|inactive|terminated|phk|pensiun|keluar|off|cancelled/.test(value)) return 'danger';
  if (/aktif|active|tetap|permanent|pkwt|kontrak/.test(value)) return 'success';
  return 'warning';
}

export function employeeInitials(name: unknown) {
  return employeeText(name).split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || '—';
}

export function employeeMasked(value: unknown, enabled: boolean) {
  const raw = employeeText(value);
  if (!enabled || raw.length < 5) return raw;
  return `${'•'.repeat(Math.min(8, raw.length - 4))}${raw.slice(-4)}`;
}

export function canManageEmployees(actor: EmployeeActor | null) {
  return Boolean(
    actor &&
    ['SUPER_ADMIN','PAYROLL_PROCESSOR'].includes(actor.role) &&
    actor.permissions?.includes('employees:write')
  );
}

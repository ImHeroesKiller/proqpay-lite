export type BillingSection = "invoice" | "tax" | "ar" | "close" | "setup";

export type BillingActor = {
  email: string;
  role: string;
  permissions?: string[];
};

export type BillingClient = {
  id: string;
  code?: string | null;
  name?: string | null;
  npwp?: string | null;
  nitku?: string | null;
  billing_address?: string | null;
  billing_email?: string | null;
  payment_terms_days?: number | null;
  tax_status?: string | null;
  purchase_order?: string | null;
  billing_method?: string | null;
  billing_rate?: number | null;
  billing_admin_fee?: number | null;
  billing_tax_rate?: number | null;
};

export type BillablePayment = {
  id: string;
  instruction_number?: string | null;
  client_id?: string | null;
  submission_id?: string | null;
  company?: string | null;
  client_name?: string | null;
  project_id?: string | null;
  project_name?: string | null;
  payroll_period?: string | null;
  payment_period?: string | null;
  expected_total?: number | null;
  payroll_total?: number | null;
  employee_count?: number | null;
};

export type BillingActivity = {
  type?: string;
  action?: string;
  at?: string;
  timestamp?: string;
  actor?: string;
  username?: string;
  role?: string;
  reference?: string;
  amount?: number;
  status?: string;
  notes?: string;
  detail?: string;
  nextFollowUpAt?: string | null;
};

export type InvoiceRecord = {
  id: string;
  submission_id?: string | null;
  client_id?: string | null;
  project_id?: string | null;
  company?: string | null;
  client_name?: string | null;
  project_name?: string | null;
  invoice_number?: string | null;
  period?: string | null;
  subtotal?: number | null;
  tax_amount?: number | null;
  total_amount?: number | null;
  status?: string | null;
  tax_status?: string | null;
  tax_invoice_status?: string | null;
  tax_invoice_number?: string | null;
  tax_invoice_date?: string | null;
  coretax_reference?: string | null;
  billing_email?: string | null;
  billing_address?: string | null;
  npwp?: string | null;
  issued_at?: string | null;
  created_at?: string | null;
  due_date?: string | null;
  tax_invoice_file_uploaded?: number | boolean;
  activity?: BillingActivity[];
  [key: string]: unknown;
};

export type ArControl = {
  invoiceTotal: number;
  paid: number;
  unapplied: number;
  outstanding: number;
  agingDays: number;
  appliedDifference: number;
};

export type ArRecord = {
  id: string;
  invoice_id?: string | null;
  invoice_number?: string | null;
  company?: string | null;
  client_name?: string | null;
  project_name?: string | null;
  amount?: number | null;
  paid_amount?: number | null;
  balance?: number | null;
  status?: string | null;
  display_status?: string | null;
  due_date?: string | null;
  aging_days?: number | null;
  aging_bucket?: string | null;
  control?: ArControl;
  activity?: BillingActivity[];
  payments?: unknown[];
  unapplied_cash?: unknown[];
  follow_ups?: unknown[];
  [key: string]: unknown;
};

export type BillingSubmission = {
  id: string;
  client_id?: string | null;
  client_name?: string | null;
  project_name?: string | null;
  period?: string | null;
  state?: string | null;
  payment_status?: string | null;
  reconciliation_status?: string | null;
  invoice_status?: string | null;
  period_status?: string | null;
  closed_by?: string | null;
  [key: string]: unknown;
};

export type BillingData = {
  clients: BillingClient[];
  billablePayments: BillablePayment[];
  invoices: InvoiceRecord[];
  arItems: ArRecord[];
  submissions: BillingSubmission[];
};

export type BillingModalKind =
  | "generate"
  | "tax"
  | "payment"
  | "setup"
  | "detail"
  | "ar-history"
  | "revise"
  | "follow-up"
  | "close";

export type BillingModalState = {
  kind: BillingModalKind;
  row: Record<string, unknown>;
};

export function billingModalTitle(kind: BillingModalKind) {
  return {
    generate: "Buat draft invoice",
    tax: "Faktur Pajak / Coretax",
    payment: "Catat penerimaan AR",
    setup: "Billing profile klien",
    detail: "Detail invoice",
    "ar-history": "Riwayat AR",
    revise: "Minta revisi invoice",
    "follow-up": "Follow-up AR",
    close: "Konfirmasi tutup periode",
  }[kind];
}

export function billingPermission(actor: BillingActor | null, permission: string, roles: string[]) {
  return Boolean(actor && roles.includes(actor.role) && actor.permissions?.includes(permission));
}

export function billingDateLabel(value: unknown) {
  if (!value) return "-";
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleDateString("id-ID");
}

export function arControlSummary(rows: ArRecord[]) {
  const summary = rows.reduce(
    (acc, row) => ({
      invoice: acc.invoice + Number(row.control?.invoiceTotal ?? row.amount ?? 0),
      paid: acc.paid + Number(row.control?.paid ?? row.paid_amount ?? 0),
      unapplied: acc.unapplied + Number(row.control?.unapplied ?? 0),
      outstanding: acc.outstanding + Number(row.control?.outstanding ?? row.balance ?? 0),
    }),
    { invoice: 0, paid: 0, unapplied: 0, outstanding: 0 },
  );
  return { ...summary, variance: summary.invoice - summary.paid - summary.outstanding };
}

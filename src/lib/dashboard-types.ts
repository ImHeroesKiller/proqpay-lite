export type DashboardActor = {
  email:string;
  role:string;
  permissions:string[];
  clientIds?:string[]|null;
};

export type DashboardPortfolioSummary = {
  clients:number;
  projects:number;
  employees:number;
  activeEmployees:number;
  primaryAccounts:number;
  bankCoveragePercent:number;
};

export type DashboardSubmission = {
  id:string;
  client_id:string;
  project_id?:string|null;
  service_plan_id?:string|null;
  service_tier?:string|null;
  period:string;
  payment_period?:string|null;
  arrears_periods?:string[];
  state:string;
  run_type?:string|null;
  source_mode?:string|null;
  input_status?:string|null;
  period_status?:string|null;
  payment_date?:string|null;
  due_date?:string|null;
  cutoff_date?:string|null;
  payment_due_date?:string|null;
  created_at?:string|null;
  updated_at?:string|null;
  client_name?:string|null;
  project_name?:string|null;
  employee_count?:number|null;
  total_gross?:number|null;
  total_deduction?:number|null;
  total_net?:number|null;
  exception_count?:number|null;
  open_exception_count?:number|null;
  client_action_count?:number|null;
  blocking_count?:number|null;
  payment_status?:string|null;
  reconciliation_status?:string|null;
  invoice_id?:string|null;
  invoice_status?:string|null;
  ar_status?:string|null;
};

export type DashboardPaymentInstruction = {
  id:string;
  client_id:string;
  submission_id:string;
  status:string;
  expected_total?:number|null;
  document_no?:string|null;
  currency?:string|null;
  recipient_count?:number|null;
  created_at?:string|null;
  updated_at?:string|null;
  payroll_period?:string|null;
  payment_period?:string|null;
  client_name?:string|null;
  project_name?:string|null;
  proof_count?:number|null;
  content_hash?:string|null;
};

export type DashboardMeta = {
  period?:string;
  submissionsTotal?:number;
  submissionsReturned?:number;
  offset?:number;
  nextOffset?:number|null;
  truncated?:boolean;
};

export type DashboardApiResponse = {
  ok?:boolean;
  submissions:DashboardSubmission[];
  paymentInstructions:DashboardPaymentInstruction[];
  exceptions?:unknown[];
  paymentProofs?:unknown[];
  reconciliations?:unknown[];
  portfolioSummary?:Partial<DashboardPortfolioSummary>;
  dashboardMeta?:DashboardMeta;
};

export type DashboardInvoice = {
  id?:string;
  period?:string|null;
  status?:string|null;
  invoice_no?:string|null;
};

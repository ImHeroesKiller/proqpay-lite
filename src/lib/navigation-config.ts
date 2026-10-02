import type { AppView } from "@/components/Sidebar";

type NavSearchItem = {
  label: string;
  keywords: string;
  view: AppView;
};

export const DEFAULT_VIEW_LABELS: Record<AppView, string> = {
  dashboard: "Dashboard",
  operations: "Pay Runs",
  exceptions: "Data Readiness",
  payments: "Payment Instructions",
  billing: "Billing & AR",
  integrations: "Integrations",
  employees: "Employees",
  clients: "Clients & Projects",
  reports: "Reports",
  logs: "Audit Logs",
  ewa: "Advance Salary",
  portalSettings: "Portal Configuration",
};

export function getViewLabel(view: AppView, role = "") {
  if (role === "CLIENT_USER") {
    const clientLabels: Partial<Record<AppView, string>> = {
      dashboard: "Home",
      operations: "Payroll",
      reports: "Documents",
      exceptions: "Payroll",
      payments: "Payroll",
      billing: "Documents",
    };
    return clientLabels[view] || DEFAULT_VIEW_LABELS[view];
  }

  if (["PAYROLL_PROCESSOR", "PAYROLL_CONTROLLER"].includes(role)) {
    const simplified: Partial<Record<AppView, string>> = {
      operations: "Payroll Workspace",
      exceptions: "Payroll Workspace",
      payments: "Payroll Workspace",
      billing: "Payroll Workspace",
    };
    return simplified[view] || DEFAULT_VIEW_LABELS[view];
  }

  return DEFAULT_VIEW_LABELS[view];
}

export const NAV_SEARCH_ITEMS: NavSearchItem[] = [
  { label: "Dashboard", keywords: "home control tower ringkasan", view: "dashboard" },
  { label: "Pay Runs", keywords: "payroll submission proses", view: "operations" },
  { label: "Data Readiness", keywords: "exception blocker issue readiness approval", view: "exceptions" },
  { label: "Payment Instructions", keywords: "payment control instruction proof reconciliation", view: "payments" },
  { label: "Billing & AR", keywords: "invoice billing piutang finance", view: "billing" },
  { label: "Integrations", keywords: "payment gateway e2pay api endpoint connected apps monitoring", view: "integrations" },
  { label: "Advance Salary", keywords: "ewa advance gaji borongan cair", view: "ewa" },
  { label: "Audit Logs", keywords: "audit log login ess portal security payment billing integration gateway api", view: "logs" },
  { label: "Employees", keywords: "karyawan rekening", view: "employees" },
  { label: "Clients & Projects", keywords: "klien project", view: "clients" },
  { label: "Reports", keywords: "laporan payment", view: "reports" },
];

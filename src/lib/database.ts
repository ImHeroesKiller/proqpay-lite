// ProQPay Lite — canonical client-side database mirror
// Operational data is loaded from Cloudflare D1. This module contains only regulatory
// reference data and an empty local cache for offline resilience.

export const DB_KEY = "proqpay_db_v3";
export const LEGACY_DB_KEYS = ["proqpay_db_v2"];

export const UMR_2025: Record<string, number> = {
  "DKI Jakarta": 5396761,
  "Jawa Barat": 2049324,
  "Jawa Tengah": 2163566,
  "DI Yogyakarta": 2660200,
  "Jawa Timur": 2246100,
  Banten: 2964563,
  Bali: 2951900,
  Aceh: 3546129,
  "Sumatera Utara": 3845000,
  "Sumatera Barat": 3092300,
  Riau: 3451000,
  "Kepulauan Riau": 3845000,
  Jambi: 3460127,
  "Sumatera Selatan": 3740250,
  "Bangka Belitung": 3905000,
  Bengkulu: 2705000,
  Lampung: 2846000,
  "Kalimantan Barat": 2953000,
  "Kalimantan Tengah": 3712000,
  "Kalimantan Selatan": 3585000,
  "Kalimantan Timur": 3775000,
  "Kalimantan Utara": 3775000,
  "Sulawesi Utara": 3815000,
  Gorontalo: 3060000,
  "Sulawesi Tengah": 3000000,
  "Sulawesi Selatan": 3658000,
  "Sulawesi Barat": 3060000,
  "Sulawesi Tenggara": 3300000,
  Maluku: 3045000,
  "Maluku Utara": 3320000,
  "Papua Barat": 3615000,
  Papua: 4268000,
  "Nusa Tenggara Barat": 2625000,
  "Nusa Tenggara Timur": 2458000,
};

export const UMR_2024: Record<string, number> = {
  "DKI Jakarta": 5067381,
  "Jawa Barat": 1986682,
  "Jawa Tengah": 2013262,
  "DI Yogyakarta": 2507000,
  "Jawa Timur": 2168531,
  Banten: 2813600,
  Bali: 2774000,
  Aceh: 3456515,
  "Sumatera Utara": 3740000,
  "Sumatera Barat": 2905000,
  Riau: 3348000,
  "Sumatera Selatan": 3645000,
  "Kalimantan Barat": 2858000,
  "Kalimantan Selatan": 3474000,
  "Kalimantan Timur": 3658000,
  "Sulawesi Selatan": 3510000,
  "Nusa Tenggara Barat": 2500000,
  "Nusa Tenggara Timur": 2330000,
};

export function seedDatabase() {
  return {
    meta: {
      createdAt: Date.now(),
      currentPeriod: new Date().toISOString().slice(0, 7),
      orgName: "ProQPay",
      dataSource: "cloudflare-d1",
    },
    employees: [] as any[],
    companies: [] as any[],
    projects: [] as any[],
    payrollRules: [] as any[],
    payrollSetups: [] as any[],
    payrolls: [] as any[],
    approvals: [] as any[],
    invoices: [] as any[],
    arMonitor: [] as any[],
    auditLogs: [] as any[],
    imports: [] as any[],
    bankTemplates: [] as any[],
  };
}

export function loadDatabase() {
  if (typeof window === "undefined") return seedDatabase();
  try {
    const data = localStorage.getItem(DB_KEY);
    if (data) return { ...seedDatabase(), ...JSON.parse(data) };
  } catch {}
  LEGACY_DB_KEYS.forEach((key) => localStorage.removeItem(key));
  const empty = seedDatabase();
  saveDatabase(empty);
  return empty;
}

export function saveDatabase(db: any) {
  if (typeof window === "undefined") return;
  localStorage.setItem(DB_KEY, JSON.stringify(db));
  LEGACY_DB_KEYS.forEach((key) => localStorage.removeItem(key));
}

export function calcEmployeePayroll(
  emp: any,
  rules: any,
  payrollSetup: any,
  period?: string,
) {
  if (
    period &&
    emp.payrollSourcePeriod === period &&
    Number(emp.importedNet || 0) > 0
  ) {
    return {
      employeeId: emp.id,
      name: emp.name,
      company: emp.company,
      project: emp.project,
      region: emp.region,
      status: emp.status,
      position: emp.position,
      bankName: emp.bankName || "",
      bankAccount: emp.bankAccount || "",
      gross: Number(emp.importedGross || 0),
      deductions: Number(emp.importedDeduction || 0),
      net: Number(emp.importedNet || 0),
      deductionBreakdown: emp.payrollComponents || {},
      salaryGross: emp.salaryGross,
      allowanceTransport: 0,
      allowanceMeal: 0,
      source: "IMPORTED_THP",
    };
  }
  const setup = payrollSetup || {};
  const gross =
    emp.salaryGross + (emp.allowanceTransport || 0) + (emp.allowanceMeal || 0);
  let deductions = 0;
  const deductionBreakdown: Record<string, number> = {};

  if (emp.bpjsKesehatan && setup.bpjsKesehatan !== false) {
    const empShare = Math.round(emp.salaryGross * 0.01);
    deductions += empShare;
    deductionBreakdown["BPJS Kesehatan"] = empShare;
  }
  if (emp.bpjsKetenagakerjaan && setup.bpjsKetenagakerjaan !== false) {
    const empShare = Math.round(emp.salaryGross * 0.02);
    deductions += empShare;
    deductionBreakdown["BPJS Ketenagakerjaan"] = empShare;
  }
  if (emp.pph21 && setup.pph21 !== false) {
    const annualGross = emp.salaryGross * 12;
    const ptkp = 54000000;
    const pkp = Math.max(0, annualGross - ptkp);
    let pph21Annual = 0;
    if (pkp <= 60000000) pph21Annual = pkp * 0.05;
    else if (pkp <= 250000000) pph21Annual = 3000000 + (pkp - 60000000) * 0.15;
    else if (pkp <= 500000000)
      pph21Annual = 31500000 + (pkp - 250000000) * 0.25;
    else pph21Annual = 94000000 + (pkp - 500000000) * 0.3;
    const pph21Monthly = Math.round(pph21Annual / 12);
    deductions += pph21Monthly;
    deductionBreakdown["PPh 21"] = pph21Monthly;
  }

  const net = gross - deductions;
  return {
    employeeId: emp.id,
    name: emp.name,
    company: emp.company,
    project: emp.project,
    region: emp.region,
    status: emp.status,
    position: emp.position,
    bankName: emp.bankName || "",
    bankAccount: emp.bankAccount || "",
    gross,
    deductions,
    net,
    deductionBreakdown,
    salaryGross: emp.salaryGross,
    allowanceTransport: emp.allowanceTransport || 0,
    allowanceMeal: emp.allowanceMeal || 0,
  };
}

export function generatePayroll(db: any, period: string) {
  const details = db.employees.map((emp: any) => {
    const company = db.companies.find((c: any) => c.name === emp.company);
    const setup = company?.payrollSetup;
    return calcEmployeePayroll(emp, db.payrollRules, setup, period);
  });
  const totalGross = details.reduce((s: number, d: any) => s + d.gross, 0);
  const totalDeduction = details.reduce(
    (s: number, d: any) => s + d.deductions,
    0,
  );
  const totalNet = totalGross - totalDeduction;
  return {
    id: `PAY${period.replace("-", "")}`,
    period,
    status: "DRAFT",
    createdAt: Date.now(),
    summary: {
      employeeCount: details.length,
      totalGross,
      totalDeduction,
      totalNet,
    },
    details,
  };
}

export type BillingSettings = {
  serviceFeePerEmp?: number;
  bpjsFeePerEmp?: number;
  adminFee?: number;
};

function nonNegative(value: unknown, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

export function generateInvoice(
  db: any,
  company: string,
  period: string,
  billing: BillingSettings = {},
) {
  const companyEmps = db.employees.filter((e: any) => e.company === company);
  const payroll = db.payrolls.find((p: any) => p.period === period);
  if (!payroll) return null;
  const companyDetails = payroll.details.filter(
    (d: any) => d.company === company,
  );
  if (
    billing.serviceFeePerEmp == null ||
    billing.bpjsFeePerEmp == null ||
    billing.adminFee == null
  ) {
    return { error: "Billing rule belum dikonfigurasi untuk client ini." };
  }
  const serviceFeePerEmp = nonNegative(billing.serviceFeePerEmp, 0);
  const bpjsFeePerEmp = nonNegative(billing.bpjsFeePerEmp, 0);
  const adminFee = nonNegative(billing.adminFee, 0);
  const serviceFee = companyDetails.length * serviceFeePerEmp;
  const bpjsFee = companyDetails.length * bpjsFeePerEmp;
  const subtotal = serviceFee + bpjsFee + adminFee;
  const tax = Math.round(subtotal * 0.1);
  return {
    id: `INV${period.replace("-", "")}-${String(db.invoices.length + 1).padStart(2, "0")}`,
    company,
    period,
    amount: subtotal,
    taxAmount: tax,
    totalAmount: subtotal + tax,
    status: "DRAFT",
    issuedAt: Date.now(),
    paidAt: null,
    items: [
      {
        desc: `Payroll Service Fee - ${companyEmps.length} karyawan`,
        qty: companyEmps.length,
        unitPrice: serviceFeePerEmp,
        amount: serviceFee,
      },
      {
        desc: "BPJS Management Fee",
        qty: companyEmps.length,
        unitPrice: bpjsFeePerEmp,
        amount: bpjsFee,
      },
      {
        desc: "Administrative Fee",
        qty: 1,
        unitPrice: adminFee,
        amount: adminFee,
      },
    ],
  };
}

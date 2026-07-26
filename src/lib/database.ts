// ProQPay Lite — Database Engine v2
// In-memory database with localStorage persistence

export const DB_KEY = 'proqpay_db_v2';

export const UMR_2025: Record<string, number> = {
  'DKI Jakarta': 5396761, 'Jawa Barat': 2049324, 'Jawa Tengah': 2163566, 'DI Yogyakarta': 2660200,
  'Jawa Timur': 2246100, 'Banten': 2964563, 'Bali': 2951900, 'Aceh': 3546129,
  'Sumatera Utara': 3845000, 'Sumatera Barat': 3092300, 'Riau': 3451000, 'Kepulauan Riau': 3845000,
  'Jambi': 3460127, 'Sumatera Selatan': 3740250, 'Bangka Belitung': 3905000, 'Bengkulu': 2705000,
  'Lampung': 2846000, 'Kalimantan Barat': 2953000, 'Kalimantan Tengah': 3712000, 'Kalimantan Selatan': 3585000,
  'Kalimantan Timur': 3775000, 'Kalimantan Utara': 3775000, 'Sulawesi Utara': 3815000, 'Gorontalo': 3060000,
  'Sulawesi Tengah': 3000000, 'Sulawesi Selatan': 3658000, 'Sulawesi Barat': 3060000, 'Sulawesi Tenggara': 3300000,
  'Maluku': 3045000, 'Maluku Utara': 3320000, 'Papua Barat': 3615000, 'Papua': 4268000,
  'Nusa Tenggara Barat': 2625000, 'Nusa Tenggara Timur': 2458000,
};

export const UMR_2024: Record<string, number> = {
  'DKI Jakarta': 5067381, 'Jawa Barat': 1986682, 'Jawa Tengah': 2013262,
  'DI Yogyakarta': 2507000, 'Jawa Timur': 2168531, 'Banten': 2813600,
  'Bali': 2774000, 'Aceh': 3456515, 'Sumatera Utara': 3740000, 'Sumatera Barat': 2905000,
  'Riau': 3348000, 'Sumatera Selatan': 3645000, 'Kalimantan Barat': 2858000,
  'Kalimantan Selatan': 3474000, 'Kalimantan Timur': 3658000, 'Sulawesi Selatan': 3510000,
  'Nusa Tenggara Barat': 2500000, 'Nusa Tenggara Timur': 2330000,
};

export const BANK_SCHEMAS: Record<string, any> = {
  'BCA': { code:'BCA', name:'Bank Central Asia', transferType:'BCA_TRANSFER', fields:['beneficiaryAccount','beneficiaryName','amount','berita'], format:'CSV' },
  'Mandiri': { code:'Mandiri', name:'Bank Mandiri', transferType:'MANDIRI_TRANSFER', fields:['beneficiaryAccount','beneficiaryName','amount','berita'], format:'CSV' },
  'BNI': { code:'BNI', name:'Bank Negara Indonesia', transferType:'BNI_TRANSFER', fields:['beneficiaryAccount','beneficiaryName','amount','berita'], format:'CSV' },
  'BRI': { code:'BRI', name:'Bank Rakyat Indonesia', transferType:'BRI_TRANSFER', fields:['beneficiaryAccount','beneficiaryName','amount','berita'], format:'CSV' },
  'CIMB': { code:'CIMB', name:'CIMB Niaga', transferType:'CIMB_TRANSFER', fields:['beneficiaryAccount','beneficiaryName','amount','berita'], format:'CSV' },
  'Permata': { code:'Permata', name:'Bank Permata', transferType:'PERMATA_TRANSFER', fields:['beneficiaryAccount','beneficiaryName','amount','berita'], format:'CSV' },
};

export function seedDatabase() {
  return {
    meta: { createdAt: Date.now(), currentPeriod: '2025-07', orgName: 'ProQPay Demo Corp' },
    employees: [
      { id:'EMP001', name:'Budi Santoso', nik:'3201010101900001', npwp:'01.234.567.8-090.000', status:'TETAP', joinDate:'2021-03-01', company:'PT Maju Bersama', project:'Managed Service Jakarta', position:'Senior Field Engineer', region:'DKI Jakarta', bankAccount:'BCA-1234567890', bankName:'BCA', salaryGross:8500000, allowanceTransport:1000000, allowanceMeal:500000, bpjsKesehatan:true, bpjsKetenagakerjaan:true, pph21:true },
      { id:'EMP002', name:'Siti Rahayu', nik:'3201024502920002', npwp:'02.345.678.9-091.000', status:'TETAP', joinDate:'2020-08-15', company:'PT Maju Bersama', project:'Managed Service Jakarta', position:'Team Lead', region:'DKI Jakarta', bankAccount:'Mandiri-9876543210', bankName:'Mandiri', salaryGross:12000000, allowanceTransport:1500000, allowanceMeal:750000, bpjsKesehatan:true, bpjsKetenagakerjaan:true, pph21:true },
      { id:'EMP003', name:'Agus Pratama', nik:'3510010101930003', npwp:'', status:'KONTRAK', joinDate:'2024-01-15', company:'PT Maju Bersama', project:'Data Center Surabaya', position:'Field Engineer', region:'Jawa Timur', bankAccount:'BNI-5555888811', bankName:'BNI', salaryGross:6500000, allowanceTransport:800000, allowanceMeal:400000, bpjsKesehatan:true, bpjsKetenagakerjaan:false, pph21:true },
      { id:'EMP004', name:'Dewi Lestari', nik:'3578010101880004', npwp:'03.456.789.0-092.000', status:'TETAP', joinDate:'2019-05-20', company:'PT Sumber Rezeki', project:'Network Infrastructure Bandung', position:'Project Manager', region:'Jawa Barat', bankAccount:'BCA-1122334455', bankName:'BCA', salaryGross:15000000, allowanceTransport:2000000, allowanceMeal:1000000, bpjsKesehatan:true, bpjsKetenagakerjaan:true, pph21:true },
      { id:'EMP005', name:'Eko Wijaya', nik:'6101010101950005', npwp:'', status:'KONTRAK', joinDate:'2024-06-01', company:'PT Sumber Rezeki', project:'Data Center Surabaya', position:'Field Engineer', region:'Kalimantan Barat', bankAccount:'BRI-9988776655', bankName:'BRI', salaryGross:5500000, allowanceTransport:600000, allowanceMeal:350000, bpjsKesehatan:false, bpjsKetenagakerjaan:false, pph21:true },
      { id:'EMP006', name:'Rina Maulida', nik:'6202010101940006', npwp:'04.567.890.1-093.000', status:'TETAP', joinDate:'2022-02-01', company:'PT Maju Bersama', project:'Managed Service Jakarta', position:'Helpdesk Support', region:'Kalimantan Selatan', bankAccount:'Mandiri-4455667788', bankName:'Mandiri', salaryGross:7000000, allowanceTransport:1000000, allowanceMeal:500000, bpjsKesehatan:true, bpjsKetenagakerjaan:true, pph21:true },
      { id:'EMP007', name:'Hendra Gunawan', nik:'7301010101900007', npwp:'05.678.901.2-094.000', status:'TETAP', joinDate:'2021-11-01', company:'PT Maju Bersama', project:'Network Infrastructure Bandung', position:'Network Engineer', region:'Sumatera Selatan', bankAccount:'BCA-6677889900', bankName:'BCA', salaryGross:9000000, allowanceTransport:1200000, allowanceMeal:600000, bpjsKesehatan:true, bpjsKetenagakerjaan:true, pph21:true },
      { id:'EMP008', name:'Lina Kusuma', nik:'5121010101970008', npwp:'', status:'KONTRAK', joinDate:'2025-01-10', company:'PT Sumber Rezeki', project:'Data Center Surabaya', position:'Junior Engineer', region:'Bali', bankAccount:'BNI-1234509876', bankName:'BNI', salaryGross:4800000, allowanceTransport:500000, allowanceMeal:300000, bpjsKesehatan:false, bpjsKetenagakerjaan:false, pph21:false },
      { id:'EMP009', name:'Joko Susilo', nik:'1101010101890009', npwp:'06.789.012.3-095.000', status:'TETAP', joinDate:'2018-07-01', company:'PT Maju Bersama', project:'Managed Service Jakarta', position:'Senior Network Engineer', region:'Aceh', bankAccount:'BCA-9988776655', bankName:'BCA', salaryGross:13000000, allowanceTransport:1800000, allowanceMeal:900000, bpjsKesehatan:true, bpjsKetenagakerjaan:true, pph21:true },
      { id:'EMP010', name:'Maya Putri', nik:'1301010101960010', npwp:'07.890.123.4-096.000', status:'TETAP', joinDate:'2023-03-15', company:'PT Sumber Rezeki', project:'Network Infrastructure Bandung', position:'QA Engineer', region:'Sumatera Barat', bankAccount:'Mandiri-1122334455', bankName:'Mandiri', salaryGross:8000000, allowanceTransport:1000000, allowanceMeal:500000, bpjsKesehatan:true, bpjsKetenagakerjaan:true, pph21:true },
      { id:'EMP011', name:'Rudi Hartono', nik:'5201010101980011', npwp:'', status:'KONTRAK', joinDate:'2024-09-01', company:'PT Maju Bersama', project:'Data Center Surabaya', position:'Field Engineer', region:'Nusa Tenggara Barat', bankAccount:'', bankName:'', salaryGross:6000000, allowanceTransport:700000, allowanceMeal:400000, bpjsKesehatan:false, bpjsKetenagakerjaan:false, pph21:true },
      { id:'EMP012', name:'Fitri Handayani', nik:'7101010101930012', npwp:'08.901.234.5-097.000', status:'TETAP', joinDate:'2020-02-01', company:'PT Sumber Rezeki', project:'Managed Service Jakarta', position:'Finance Admin', region:'Riau', bankAccount:'BCA-5544332211', bankName:'BCA', salaryGross:7500000, allowanceTransport:1000000, allowanceMeal:500000, bpjsKesehatan:true, bpjsKetenagakerjaan:true, pph21:true },
    ],
    companies: [
      { id:'CMP01', name:'PT Maju Bersama', npwp:'01.234.567.8-090.000', address:'Jl. Sudirman No.1, Jakarta', pic:'Budi Santoso', phone:'021-5550101', payrollType:'BULANAN', payrollSetup: { type:'BULANAN', umrRegion:'DKI Jakarta', umrYear:2025, bpjsKesehatan:true, bpjsKetenagakerjaan:true, pph21:true, allowanceTransport:true, allowanceMeal:true, overtime:true, cutOffDate:25, payDate:28 } },
      { id:'CMP02', name:'PT Sumber Rezeki', npwp:'02.345.678.9-091.000', address:'Jl. Diponegoro No.2, Surabaya', pic:'Dewi Lestari', phone:'031-5550202', payrollType:'BULANAN', payrollSetup: { type:'BULANAN', umrRegion:'Jawa Timur', umrYear:2025, bpjsKesehatan:true, bpjsKetenagakerjaan:true, pph21:true, allowanceTransport:true, allowanceMeal:true, overtime:true, cutOffDate:25, payDate:28 } },
    ],
    projects: [
      { id:'PRJ01', name:'Managed Service Jakarta', company:'PT Maju Bersama', region:'DKI Jakarta', startDate:'2024-01-01', budget:1500000000, status:'ACTIVE' },
      { id:'PRJ02', name:'Data Center Surabaya', company:'PT Sumber Rezeki', region:'Jawa Timur', startDate:'2024-03-01', budget:800000000, status:'ACTIVE' },
      { id:'PRJ03', name:'Network Infrastructure Bandung', company:'PT Sumber Rezeki', region:'Jawa Barat', startDate:'2023-06-01', budget:1200000000, status:'ACTIVE' },
    ],
    payrollRules: [
      { id:'R001', name:'BPJS Kesehatan', rule:'4% dari gaji (employer), 1% dari gaji (employee)', applyTo:'TETAP', active:true },
      { id:'R002', name:'BPJS Ketenagakerjaan', rule:'5.7% dari gaji (employer), 2% dari gaji (employee)', applyTo:'TETAP', active:true },
      { id:'R003', name:'PPh 21', rule:'Progresif sesuai tarif PPh 21 TER', applyTo:'ALL', active:true },
      { id:'R004', name:'Uang Lembur', rule:'1.5x untuk jam pertama, 2x untuk jam berikutnya', applyTo:'ALL', active:true },
    ],
    payrollSetups: [] as any[],
    payrolls: [
      {
        id:'PAY202506', period:'2025-06', status:'PAID', createdAt:Date.now()-30*86400000,
        summary: { employeeCount:12, totalGross:112300000, totalDeduction:18400000, totalNet:93900000 },
        details: [] as any[]
      }
    ],
    approvals: [] as any[],
    payments: [
      { id:'PMT202506', payrollId:'PAY202506', period:'2025-06', bank:'BCA', account:'1234567890', amount:93900000, status:'PAID', paidAt:Date.now()-25*86400000, reference:'BCA-TRX-202506-001', createdAt:Date.now()-28*86400000 }
    ],
    invoices: [
      { id:'INV202506-01', company:'PT Maju Bersama', period:'2025-06', amount:102000000, taxAmount:10200000, totalAmount:112200000, status:'PAID', issuedAt:Date.now()-28*86400000, paidAt:Date.now()-20*86400000, items:[{desc:'Payroll Service Fee - Managed Service Jakarta', qty:7, unitPrice:10000000, amount:70000000},{desc:'BPJS Management Fee', qty:7, unitPrice:3000000, amount:21000000},{desc:'PPH21 Processing Fee', qty:7, unitPrice:1000000, amount:7000000},{desc:'Administrative Fee', qty:1, unitPrice:4000000, amount:4000000}] },
      { id:'INV202506-02', company:'PT Sumber Rezeki', period:'2025-06', amount:98000000, taxAmount:9800000, totalAmount:107800000, status:'SENT', issuedAt:Date.now()-28*86400000, paidAt:null, items:[{desc:'Payroll Service Fee - Network Infrastructure Bandung', qty:5, unitPrice:10000000, amount:50000000},{desc:'Data Center Surabaya Staffing', qty:4, unitPrice:8000000, amount:32000000},{desc:'BPJS Management Fee', qty:5, unitPrice:3000000, amount:15000000},{desc:'Administrative Fee', qty:1, unitPrice:1000000, amount:1000000}] },
    ],
    arMonitor: [
      { id:'AR001', company:'PT Sumber Rezeki', invoiceId:'INV202506-02', amount:107800000, status:'OUTSTANDING', dueDate:Date.now()+5*86400000, daysOverdue:0, type:'REIMBURSE', notes:'Invoice payroll Juni - menunggu pembayaran dari klien' },
    ],
    auditLogs: [
      { id:'LOG001', timestamp:Date.now()-25*86400000, user:'Super Admin', role:'SUPER_ADMIN', action:'PAYMENT_CONFIRMED', detail:'Payment instruction PMT202506 dikonfirmasi untuk periode 2025-06', entity:'Payment', entityId:'PMT202506' },
      { id:'LOG002', timestamp:Date.now()-28*86400000, user:'Super Admin', role:'SUPER_ADMIN', action:'PAYMENT_INSTRUCTION_CREATED', detail:'Payment instruction PMT202506 dibuat untuk periode 2025-06', entity:'Payment', entityId:'PMT202506' },
      { id:'LOG003', timestamp:Date.now()-30*86400000, user:'Super Admin', role:'SUPER_ADMIN', action:'PAYROLL_CALCULATED', detail:'Payroll periode 2025-06 dihitung: 12 karyawan, total net Rp 93.900.000', entity:'Payroll', entityId:'PAY202506' },
      { id:'LOG004', timestamp:Date.now()-30*86400000, user:'Super Admin', role:'SUPER_ADMIN', action:'PAYROLL_APPROVED', detail:'Payroll periode 2025-06 disetujui', entity:'Payroll', entityId:'PAY202506' },
    ],
    imports: [] as any[],
    bankTemplates: [] as any[],
  };
}

export function loadDatabase() {
  if (typeof window === 'undefined') return seedDatabase();
  try {
    const data = localStorage.getItem(DB_KEY);
    if (data) return JSON.parse(data);
  } catch (e) {}
  const seed = seedDatabase();
  saveDatabase(seed);
  return seed;
}

export function saveDatabase(db: any) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(DB_KEY, JSON.stringify(db));
}

export function calcEmployeePayroll(emp: any, rules: any, payrollSetup: any) {
  const setup = payrollSetup || {};
  const gross = emp.salaryGross + (emp.allowanceTransport || 0) + (emp.allowanceMeal || 0);
  let deductions = 0;
  const deductionBreakdown: Record<string, number> = {};

  if (emp.bpjsKesehatan && setup.bpjsKesehatan !== false) {
    const empShare = Math.round(emp.salaryGross * 0.01);
    deductions += empShare;
    deductionBreakdown['BPJS Kesehatan'] = empShare;
  }
  if (emp.bpjsKetenagakerjaan && setup.bpjsKetenagakerjaan !== false) {
    const empShare = Math.round(emp.salaryGross * 0.02);
    deductions += empShare;
    deductionBreakdown['BPJS Ketenagakerjaan'] = empShare;
  }
  if (emp.pph21 && setup.pph21 !== false) {
    const annualGross = emp.salaryGross * 12;
    let ptkp = 54000000;
    let pkp = Math.max(0, annualGross - ptkp);
    let pph21Annual = 0;
    if (pkp <= 60000000) pph21Annual = pkp * 0.05;
    else if (pkp <= 250000000) pph21Annual = 3000000 + (pkp - 60000000) * 0.15;
    else if (pkp <= 500000000) pph21Annual = 31500000 + (pkp - 250000000) * 0.25;
    else pph21Annual = 94000000 + (pkp - 500000000) * 0.30;
    const pph21Monthly = Math.round(pph21Annual / 12);
    deductions += pph21Monthly;
    deductionBreakdown['PPh 21'] = pph21Monthly;
  }

  const net = gross - deductions;
  return {
    employeeId: emp.id, name: emp.name, company: emp.company, project: emp.project, region: emp.region,
    status: emp.status, position: emp.position, bankName: emp.bankName || '', bankAccount: emp.bankAccount || '',
    gross, deductions, net, deductionBreakdown, salaryGross: emp.salaryGross,
    allowanceTransport: emp.allowanceTransport || 0, allowanceMeal: emp.allowanceMeal || 0,
  };
}

export function generatePayroll(db: any, period: string) {
  const details = db.employees.map((emp: any) => {
    const company = db.companies.find((c: any) => c.name === emp.company);
    const setup = company?.payrollSetup;
    return calcEmployeePayroll(emp, db.payrollRules, setup);
  });
  const totalGross = details.reduce((s: number, d: any) => s + d.gross, 0);
  const totalDeduction = details.reduce((s: number, d: any) => s + d.deductions, 0);
  const totalNet = totalGross - totalDeduction;
  return {
    id: `PAY${period.replace('-','')}`, period, status: 'DRAFT', createdAt: Date.now(),
    summary: { employeeCount: details.length, totalGross, totalDeduction, totalNet }, details
  };
}

export function generatePaymentFile(db: any, period: string, bankTemplate: any) {
  const payroll = db.payrolls.find((p: any) => p.period === period);
  if (!payroll || !payroll.details) return null;
  const schema = BANK_SCHEMAS[bankTemplate.bank] || BANK_SCHEMAS['BCA'];
  const lines = [];
  lines.push(schema.fields.join(';'));
  payroll.details.forEach((d: any) => {
    const account = d.bankAccount ? d.bankAccount.split('-').pop() : '';
    const name = d.name.replace(/[^a-zA-Z\s]/g,'').toUpperCase().trim();
    const amount = d.net;
    const berita = `PAYROLL ${period}`;
    lines.push([account, name, amount, berita].join(';'));
  });
  return { content: lines.join('\n'), filename: `payment_${bankTemplate.bank}_${period}.csv`, schema };
}

export function generateInvoice(db: any, company: string, period: string) {
  const companyEmps = db.employees.filter((e: any) => e.company === company);
  const payroll = db.payrolls.find((p: any) => p.period === period);
  if (!payroll) return null;
  const companyDetails = payroll.details.filter((d: any) => d.company === company);
  const serviceFee = companyDetails.length * 1500000;
  const bpjsFee = companyDetails.length * 300000;
  const adminFee = 2000000;
  const subtotal = serviceFee + bpjsFee + adminFee;
  const tax = Math.round(subtotal * 0.10);
  return {
    id: `INV${period.replace('-','')}-${String(db.invoices.length + 1).padStart(2,'0')}`,
    company, period, amount: subtotal, taxAmount: tax, totalAmount: subtotal + tax,
    status: 'DRAFT', issuedAt: Date.now(), paidAt: null,
    items: [
      { desc: `Payroll Service Fee - ${companyEmps.length} karyawan`, qty: companyEmps.length, unitPrice: 1500000, amount: serviceFee },
      { desc: 'BPJS Management Fee', qty: companyEmps.length, unitPrice: 300000, amount: bpjsFee },
      { desc: 'Administrative Fee', qty: 1, unitPrice: 2000000, amount: adminFee },
    ]
  };
}

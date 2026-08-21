import readXlsxFile from 'read-excel-file/universal';
import { resolveWorkLocation } from './wilayah';

/** Excel serial → YYYY-MM-DD */
export function excelSerialToDate(n: unknown): string | null {
  if (n == null || n === '' || n === '-') return null;
  if (n instanceof Date) return Number.isNaN(n.getTime()) ? null : n.toISOString().slice(0, 10);
  if (typeof n === 'string' && /^\d{4}-\d{2}-\d{2}/.test(n)) return n.slice(0, 10);
  const num = Number(n);
  if (!num || Number.isNaN(num)) return null;
  const epoch = Date.UTC(1899, 11, 30);
  const d = new Date(epoch + num * 86400000);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function cell(row: Record<string, unknown>, ...keys: string[]) {
  for (const k of keys) {
    if (row[k] != null && String(row[k]).trim() !== '' && String(row[k]).trim() !== '-') {
      return row[k];
    }
  }
  // case-insensitive fallback
  const lower = Object.fromEntries(
    Object.entries(row).map(([k, v]) => [k.toLowerCase().trim(), v])
  );
  for (const k of keys) {
    const v = lower[k.toLowerCase()];
    if (v != null && String(v).trim() !== '' && String(v).trim() !== '-') return v;
  }
  return null;
}

export type ParsedEmployee = {
  sourceSheet: string;
  nrk: string;
  name: string;
  company: string;
  client: string;
  clientCode: string;
  birthPlace: string | null;
  birthDate: string | null;
  gender: string | null;
  marital: string | null;
  ptkpClaimed: string | null;
  ptkpUpdated: string | null;
  ktp: string | null;
  address: string | null;
  phone: string | null;
  mobile: string | null;
  religion: string | null;
  acceptedDate: string | null;
  joinDate: string | null;
  employmentType: string | null;
  contractStatus: string | null;
  contractStart: string | null;
  contractEnd: string | null;
  resignDate: string | null;
  salaryStart: string | null;
  basicSalary: number;
  branch: string | null;
  pic: string | null;
  lokasi: string | null;
  unitKerja: string | null;
  position: string | null;
  kotaUmk: string | null;
  npwp: string | null;
  motherName: string | null;
  bank: string | null;
  accountNo: string | null;
  hrisUser: string | null;
  hrbp: string | null;
  bpjsKes: string | null;
  bpjsKesEffective: string | null;
  jamsostek: string | null;
  email: string | null;
  educationLevel: string | null;
  school: string | null;
  major: string | null;
  graduateYear: number | null;
  resignReason: string | null;
  candidateSource: string | null;
  statusAktif: string | null;
  province: string;
  provinceCode: string | null;
  grossPay: number;
  totalDeductions: number;
  netPay: number;
  payrollComponents: Record<string, number>;
};

export type WorkbookSheetDiagnostic = {
  sheetName: string;
  headerRow: number | null;
  totalRaw: number;
  accepted: number;
  skipped: number;
  kind: 'EMPLOYEE_DATA' | 'NON_EMPLOYEE_SHEET';
};

function numericCell(value: unknown): number {
  if (value == null || value === '' || String(value).trim() === '-') return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const text = String(value).trim();
  const negative = /^\(.*\)$/.test(text);
  const normalized = text.replace(/[()\s]/g, '').replace(/[^0-9,.-]/g, '');
  if (!normalized || normalized === '-') return 0;
  let decimal = normalized;
  if (/^-?\d{1,3}(,\d{3})+$/.test(normalized)) decimal = normalized.replaceAll(',', '');
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(normalized)) decimal = normalized.replaceAll('.', '');
  else if (normalized.includes(',') && normalized.includes('.')) {
    decimal = normalized.lastIndexOf(',') > normalized.lastIndexOf('.')
      ? normalized.replaceAll('.', '').replace(',', '.')
      : normalized.replaceAll(',', '');
  } else if (normalized.includes(',')) decimal = normalized.replace(',', '.');
  const parsed = Number(decimal);
  return Number.isFinite(parsed) ? (negative ? -Math.abs(parsed) : parsed) : 0;
}

function normalizedHeader(value: unknown) {
  return String(value || '').trim().toUpperCase().replace(/\s+/g, ' ');
}

const KNOWN_HEADERS = new Set([
  'NO', 'NRK', 'NAMA', 'NAMA KARYAWAN', 'KODE CLIENT', 'KODE KLIEN', 'NAMA CLIENT',
  'KLIEN', 'LOKASI', 'LOKASI KERJA', 'REGIONAL', 'NAMA CABANG', 'POSISI', 'JABATAN',
  'DEPT', 'USER', 'NPWP', 'NAMA BANK', 'NO REK', 'GAJI POKOK', 'GROSS', 'DEDUCT', 'NETTO',
]);

function findEmployeeHeaderRow(matrix: unknown[][]): number | null {
  let bestIndex: number | null = null;
  let bestScore = -1;
  matrix.slice(0, 100).forEach((row, index) => {
    const headers = new Set((row || []).map(normalizedHeader).filter(Boolean));
    const hasNrk = headers.has('NRK') || headers.has('NIK KARYAWAN') || headers.has('EMPLOYEE ID');
    const hasName = headers.has('NAMA') || headers.has('NAMA KARYAWAN') || headers.has('EMPLOYEE NAME');
    if (!hasNrk || !hasName) return;
    const score = [...headers].filter((header) => KNOWN_HEADERS.has(header)).length;
    if (score > bestScore) { bestIndex = index; bestScore = score; }
  });
  return bestIndex;
}

function rowsFromMatrix(matrix: unknown[][], headerRow: number): Record<string, unknown>[] {
  const headers = (matrix[headerRow] || []).map((value) => String(value ?? '').trim());
  return matrix.slice(headerRow + 1).flatMap((values) => {
    const row: Record<string, unknown> = {};
    let hasValue = false;
    headers.forEach((header, index) => {
      if (!header) return;
      const value = values?.[index] ?? null;
      row[header] = value;
      if (value != null && String(value).trim() !== '') hasValue = true;
    });
    return hasValue ? [row] : [];
  });
}

function payrollComponents(row: Record<string, unknown>) {
  return {
    basicSalary: numericCell(cell(row, 'Gaji Pokok')),
    salaryArrears: numericCell(cell(row, 'Rapel Gaji')),
    allowanceArrears: numericCell(cell(row, 'Rapel Tunj')),
    overtime: numericCell(cell(row, 'Lembur')),
    positionAllowance: numericCell(cell(row, 'Tunj Jabatan')),
    mealAllowance: numericCell(cell(row, 'Tunj Makan')),
    transportAllowance: numericCell(cell(row, 'Tunj Transport')),
    phoneAllowance: numericCell(cell(row, 'Tunj Pulsa')),
    attendanceAllowance: numericCell(cell(row, 'Tunj Kehadiran')),
    otherAllowance: numericCell(cell(row, 'Tunj Lain')),
    incentive: numericCell(cell(row, 'Insentif')),
    shift: numericCell(cell(row, 'Shift')),
    medical: numericCell(cell(row, 'Medical')),
    bonusOrLeave: numericCell(cell(row, 'Bonus/ Uang Cuti', 'THR / Bonus', 'Cuti')),
    attendanceDeduction: numericCell(cell(row, 'Pot. Kehadiran')),
    taxAllowance: numericCell(cell(row, 'Tunj Pajak')),
    bpjsTk: numericCell(cell(row, 'BPJS TK')),
    bpjsHealth: numericCell(cell(row, 'BPJS Kes.')),
    jhtDeduction: numericCell(cell(row, 'Pot. JHT')),
    pensionDeduction: numericCell(cell(row, 'Pot. Pensiun')),
    bpjsHealthDeduction: numericCell(cell(row, 'Pot. BPJS Kes')),
    cooperativeDeduction: numericCell(cell(row, 'Pot. Koperasi')),
    otherDeduction: numericCell(cell(row, 'Pot. Lain')),
    taxDeduction: numericCell(cell(row, 'Pot. Pajak')),
  };
}

function parseEmployeeRow(r: Record<string, unknown>, sourceSheet: string): ParsedEmployee | null {
  const nrk = String(cell(r, 'NRK', 'NIK Karyawan', 'Employee ID') || '').trim();
  const name = String(cell(r, 'Nama Karyawan', 'Nama', 'Employee Name') || '').trim();
  if (!nrk || !name) return null;

  const lokasiValue = cell(r, 'Lokasi', 'Lokasi Kerja', 'Penempatan');
  const branchValue = cell(r, 'Cabang', 'Nama Cabang', 'Regional', 'Region');
  const kotaValue = cell(r, 'Kota UMK', 'Kota Umk', 'Kota');
  const unitValue = cell(r, 'Unit Kerja', 'Dept', 'Department');
  const lokasi = lokasiValue != null ? String(lokasiValue).trim() : null;
  const branch = branchValue != null ? String(branchValue).trim() : null;
  const kotaUmk = kotaValue != null ? String(kotaValue).trim() : null;
  const unitKerja = unitValue != null ? String(unitValue).trim() : null;
  const wilayah = resolveWorkLocation({ lokasi: lokasi || undefined, cabang: branch || undefined, kotaUmk: kotaUmk || undefined, unitKerja: unitKerja || undefined });
  const components = payrollComponents(r);
  const yearRaw = cell(r, 'Tahun Lulus');
  const graduateYear = yearRaw != null && !Number.isNaN(Number(yearRaw)) ? Number(yearRaw) : null;
  const client = String(cell(r, 'Klien', 'Nama Client', 'Nama Klien', 'Client') || '').trim();
  const company = String(cell(r, 'Nama Perusahaan', 'Perusahaan', 'Nama Client', 'Nama Klien') || client || 'OTSINDO').trim();

  return {
    sourceSheet,
    nrk,
    name,
    company,
    client: client || company,
    clientCode: String(cell(r, 'Kode Klien', 'Kode Client', 'Client Code') || '').trim(),
    birthPlace: cell(r, 'Tempat Lahir') != null ? String(cell(r, 'Tempat Lahir')) : null,
    birthDate: excelSerialToDate(cell(r, 'Tanggal Lahir')),
    gender: cell(r, 'Jenis Kelamin', 'Gender') != null ? String(cell(r, 'Jenis Kelamin', 'Gender')) : null,
    marital: cell(r, 'Status Perkawinan') != null ? String(cell(r, 'Status Perkawinan')) : null,
    ptkpClaimed: cell(r, 'Status PTKP di Akui') != null ? String(cell(r, 'Status PTKP di Akui')) : null,
    ptkpUpdated: cell(r, 'Status PTKP Terupdate') != null ? String(cell(r, 'Status PTKP Terupdate')) : null,
    ktp: cell(r, 'No KTP', 'NIK') != null ? String(cell(r, 'No KTP', 'NIK')) : null,
    address: cell(r, 'Alamat') != null ? String(cell(r, 'Alamat')) : null,
    phone: cell(r, 'No Telp') != null ? String(cell(r, 'No Telp')) : null,
    mobile: cell(r, 'No HP') != null ? String(cell(r, 'No HP')) : null,
    religion: cell(r, 'Agama') != null ? String(cell(r, 'Agama')) : null,
    acceptedDate: excelSerialToDate(cell(r, 'Tanggal Diterima')),
    joinDate: excelSerialToDate(cell(r, 'Tanggal Join')),
    employmentType: cell(r, 'Status Pegawai', 'Status Karyawan') != null ? String(cell(r, 'Status Pegawai', 'Status Karyawan')) : null,
    contractStatus: cell(r, 'Status', 'Status Karyawan') != null ? String(cell(r, 'Status', 'Status Karyawan')) : null,
    contractStart: excelSerialToDate(cell(r, 'Awal Kontrak')),
    contractEnd: excelSerialToDate(cell(r, 'Akhir Kontrak')),
    resignDate: excelSerialToDate(cell(r, 'Berhenti')),
    salaryStart: excelSerialToDate(cell(r, 'TMT Gaji')),
    basicSalary: Math.round(components.basicSalary),
    branch,
    pic: cell(r, 'PIC', 'PIC Korlap') != null ? String(cell(r, 'PIC', 'PIC Korlap')) : null,
    lokasi,
    unitKerja,
    position: cell(r, 'Jabatan', 'Posisi') != null ? String(cell(r, 'Jabatan', 'Posisi')) : null,
    kotaUmk,
    npwp: cell(r, 'No NPWP', 'NPWP') != null ? String(cell(r, 'No NPWP', 'NPWP')) : null,
    motherName: cell(r, 'Nama Ibu Kandung') != null ? String(cell(r, 'Nama Ibu Kandung')) : null,
    bank: cell(r, 'Bank', 'Nama Bank') != null ? String(cell(r, 'Bank', 'Nama Bank')) : null,
    accountNo: cell(r, 'Rekening', 'No Rek', 'No Rekening') != null ? String(cell(r, 'Rekening', 'No Rek', 'No Rekening')).trim() : null,
    hrisUser: cell(r, 'User') != null ? String(cell(r, 'User')) : null,
    hrbp: cell(r, 'HRBP') != null ? String(cell(r, 'HRBP')) : null,
    bpjsKes: cell(r, 'No. BPJS Kesehatan', 'No BPJS Kesehatan') != null ? String(cell(r, 'No. BPJS Kesehatan', 'No BPJS Kesehatan')) : null,
    bpjsKesEffective: excelSerialToDate(cell(r, 'Tanggal Efektif BPJS')),
    jamsostek: cell(r, 'No. Jamsostek', 'No Jamsostek') != null ? String(cell(r, 'No. Jamsostek', 'No Jamsostek')) : null,
    email: cell(r, 'Alamat Email', 'Email') != null ? String(cell(r, 'Alamat Email', 'Email')).trim() : null,
    educationLevel: cell(r, 'Pendidikan') != null ? String(cell(r, 'Pendidikan')) : null,
    school: cell(r, 'Nama Sekolah') != null ? String(cell(r, 'Nama Sekolah')) : null,
    major: cell(r, 'Jurusan') != null ? String(cell(r, 'Jurusan')) : null,
    graduateYear,
    resignReason: cell(r, 'Keterangan Berhenti') != null ? String(cell(r, 'Keterangan Berhenti')) : null,
    candidateSource: cell(r, 'Kandidat') != null ? String(cell(r, 'Kandidat')) : null,
    statusAktif: cell(r, 'Status Pegawai', 'Status Karyawan') != null ? String(cell(r, 'Status Pegawai', 'Status Karyawan')) : null,
    province: wilayah.province,
    provinceCode: wilayah.provinceCode,
    grossPay: Math.round(numericCell(cell(r, 'Gross'))),
    totalDeductions: Math.round(numericCell(cell(r, 'Deduct', 'Total Potongan'))),
    netPay: Math.round(numericCell(cell(r, 'Netto', 'THP', 'Take Home Pay'))),
    payrollComponents: components,
  };
}

export async function parseIapWorkbook(buffer: ArrayBuffer): Promise<{
  rows: ParsedEmployee[];
  sheetName: string;
  totalRaw: number;
  skipped: number;
  duplicateRows: number;
  diagnostics: WorkbookSheetDiagnostic[];
  payrollSummary: { gross: number; deductions: number; net: number };
}> {
  const workbook = await readXlsxFile(buffer);
  const candidates: Array<{ sheetName: string; raw: Record<string, unknown>[]; rows: ParsedEmployee[]; skipped: number; headerRow: number }> = [];
  const diagnostics: WorkbookSheetDiagnostic[] = [];

  for (const sheet of workbook) {
    const sheetName = sheet.sheet;
    const matrix: unknown[][] = sheet.data;
    const headerRow = findEmployeeHeaderRow(matrix);
    if (headerRow == null) {
      diagnostics.push({ sheetName, headerRow: null, totalRaw: 0, accepted: 0, skipped: 0, kind: 'NON_EMPLOYEE_SHEET' });
      continue;
    }
    const raw = rowsFromMatrix(matrix, headerRow);
    const parsedRows = raw.map((row) => parseEmployeeRow(row, sheetName)).filter((row): row is ParsedEmployee => row != null);
    const skipped = raw.length - parsedRows.length;
    if (parsedRows.length) {
      candidates.push({ sheetName, raw, rows: parsedRows, skipped, headerRow });
      diagnostics.push({ sheetName, headerRow: headerRow + 1, totalRaw: raw.length, accepted: parsedRows.length, skipped, kind: 'EMPLOYEE_DATA' });
    } else {
      diagnostics.push({ sheetName, headerRow: headerRow + 1, totalRaw: raw.length, accepted: 0, skipped: 0, kind: 'NON_EMPLOYEE_SHEET' });
    }
  }

  candidates.sort((left, right) => right.rows.length - left.rows.length);
  const rows: ParsedEmployee[] = [];
  const seen = new Set<string>();
  let duplicateRows = 0;
  let skipped = 0;
  for (const candidate of candidates) {
    skipped += candidate.skipped;
    for (const row of candidate.rows) {
      const key = row.nrk.toUpperCase();
      if (seen.has(key)) { duplicateRows += 1; continue; }
      seen.add(key);
      rows.push(row);
    }
  }

  const payrollSummary = rows.reduce((summary, row) => ({
    gross: summary.gross + row.grossPay,
    deductions: summary.deductions + row.totalDeductions,
    net: summary.net + row.netPay,
  }), { gross: 0, deductions: 0, net: 0 });
  const selectedSheets = [...new Set(rows.map((row) => row.sourceSheet))];
  return {
    rows,
    sheetName: selectedSheets.join(', ') || workbook[0]?.sheet || '',
    totalRaw: candidates.reduce((total, candidate) => total + candidate.raw.length, 0),
    skipped,
    duplicateRows,
    diagnostics,
    payrollSummary,
  };
}

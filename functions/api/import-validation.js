export const MAX_IMPORT_ROWS = 500;
export const MAX_IMPORT_BYTES = 6 * 1024 * 1024;

const DATE_FIELDS = [
  'birthDate',
  'joinDate',
  'acceptedDate',
  'contractStart',
  'contractEnd',
  'resignDate',
  'salaryStart',
  'bpjsKesEffective',
];

const STRING_LIMITS = {
  nrk: 80,
  name: 200,
  clientCode: 80,
  client: 200,
  company: 200,
  branch: 200,
  lokasi: 250,
  unitKerja: 250,
  province: 100,
  kotaUmk: 150,
  position: 200,
  pic: 200,
  hrbp: 200,
  ktp: 32,
  npwp: 40,
  email: 254,
  phone: 40,
  mobile: 40,
  accountNo: 80,
  bank: 100,
  address: 1000,
};

function isValidDate(value) {
  if (value == null || value === '') return true;
  if (typeof value !== 'string') return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function cleanString(value) {
  if (value == null) return null;
  const clean = String(value).trim();
  return clean || null;
}

function normalizeRow(row) {
  const normalized = { ...row };
  for (const field of Object.keys(STRING_LIMITS)) {
    if (field in normalized) normalized[field] = cleanString(normalized[field]);
  }
  for (const field of DATE_FIELDS) {
    if (field in normalized) normalized[field] = cleanString(normalized[field]);
  }

  const salary = Number(normalized.basicSalary ?? 0);
  normalized.basicSalary = Number.isFinite(salary) ? salary : normalized.basicSalary;
  normalized.nrk = cleanString(normalized.nrk);
  normalized.name = cleanString(normalized.name);
  return normalized;
}

export function validateImportRows(input) {
  if (!Array.isArray(input) || input.length === 0) {
    return { ok: false, rows: [], issues: [{ row: 0, field: 'rows', message: 'rows[] required' }] };
  }
  if (input.length > MAX_IMPORT_ROWS) {
    return {
      ok: false,
      rows: [],
      issues: [
        {
          row: 0,
          field: 'rows',
          message: `Maksimal ${MAX_IMPORT_ROWS} baris per request`,
        },
      ],
    };
  }

  const issues = [];
  const rows = input.map(normalizeRow);
  const seen = new Map();

  rows.forEach((row, index) => {
    const rowNo = index + 1;
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      issues.push({ row: rowNo, field: 'row', message: 'Format baris tidak valid' });
      return;
    }
    if (!row.nrk) issues.push({ row: rowNo, field: 'nrk', message: 'NRK wajib diisi' });
    if (!row.name) issues.push({ row: rowNo, field: 'name', message: 'Nama wajib diisi' });

    if (row.nrk) {
      const key = row.nrk.toUpperCase();
      if (seen.has(key)) {
        issues.push({
          row: rowNo,
          field: 'nrk',
          message: `NRK duplikat dengan baris ${seen.get(key)}`,
        });
      } else {
        seen.set(key, rowNo);
      }
    }

    for (const [field, max] of Object.entries(STRING_LIMITS)) {
      if (row[field] != null && String(row[field]).length > max) {
        issues.push({ row: rowNo, field, message: `Maksimal ${max} karakter` });
      }
    }

    for (const field of DATE_FIELDS) {
      if (!isValidDate(row[field])) {
        issues.push({ row: rowNo, field, message: 'Tanggal harus valid dengan format YYYY-MM-DD' });
      }
    }

    if (!Number.isFinite(row.basicSalary) || row.basicSalary < 0) {
      issues.push({ row: rowNo, field: 'basicSalary', message: 'Gaji harus berupa angka minimal 0' });
    }
    if (row.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email)) {
      issues.push({ row: rowNo, field: 'email', message: 'Format email tidak valid' });
    }
  });

  return { ok: issues.length === 0, rows, issues: issues.slice(0, 100) };
}

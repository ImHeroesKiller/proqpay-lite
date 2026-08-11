import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
import * as XLSX from 'xlsx';

async function loadParser() {
  const source = await readFile(new URL('../src/lib/excel-iap.ts', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  const require = (specifier) => {
    if (specifier === 'xlsx') return XLSX;
    if (specifier === './wilayah') return {
      resolveWorkLocation: ({ cabang, lokasi }) => ({ province: cabang || lokasi || 'Tidak diketahui', provinceCode: null }),
    };
    throw new Error(`Unexpected import ${specifier}`);
  };
  new Function('exports', 'require', compiled)(exports, require);
  return exports;
}

function workbookBuffer() {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['REQUEST PAYMENT'],
    ['NO REQUEST', 'PPE-001'],
    [],
    ['NRK', 'NAMA', 'NOMINAL'],
    ['', '', 10_000_000],
  ]), 'REQUEST PAYMENT');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['NO', 'NRK', 'NAMA', 'NAMA CLIENT', 'LOKASI KERJA', 'REGIONAL', 'POSISI', 'NAMA BANK', 'NO REK', ' GAJI POKOK ', ' GROSS ', ' DEDUCT ', ' NETTO '],
    [1, 'EMP-001', 'ARY', 'PT QJOB SAKA GEMILANG', 'JAKARTA', 'DKI Jakarta', 'ENGINEER', 'MANDIRI', '0012345', 3_000_000, 4_000_000, 500_000, 3_500_000],
    [2, 'EMP-002', 'BUDI', 'PT QJOB SAKA GEMILANG', 'BANDUNG', 'Jawa Barat', 'AGENT', 'BRI', '0098765', 2_500_000, 3_000_000, 400_000, 2_600_000],
  ]), 'THP CLOSING');
  const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
  if (bytes instanceof ArrayBuffer) return bytes;
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

test('parser scans all sheets and selects employee datasheet instead of first payment form', async () => {
  const parser = await loadParser();
  const result = parser.parseIapWorkbook(workbookBuffer());
  assert.equal(result.rows.length, 2);
  assert.equal(result.sheetName, 'THP CLOSING');
  assert.equal(result.rows[0].nrk, 'EMP-001');
  assert.equal(result.rows[0].client, 'PT QJOB SAKA GEMILANG');
  assert.equal(result.rows[0].basicSalary, 3_000_000);
  assert.equal(result.rows[0].accountNo, '0012345');
  assert.deepEqual(result.payrollSummary, { gross: 7_000_000, deductions: 900_000, net: 6_100_000 });
  assert.equal(result.diagnostics.find((sheet) => sheet.sheetName === 'REQUEST PAYMENT').kind, 'NON_EMPLOYEE_SHEET');
});

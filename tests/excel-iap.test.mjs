import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
import ExcelJS from 'exceljs';

async function loadParser() {
  const source = await readFile(new URL('../src/lib/excel-iap.ts', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  const readXlsxFile = (await import('read-excel-file/universal')).default;
  const require = (specifier) => {
    if (specifier === 'read-excel-file/universal') {
      return { __esModule: true, default: readXlsxFile };
    }
    if (specifier === './wilayah') return {
      resolveWorkLocation: ({ cabang, lokasi }) => ({ province: cabang || lokasi || 'Tidak diketahui', provinceCode: null }),
    };
    throw new Error(`Unexpected import ${specifier}`);
  };
  new Function('exports', 'require', compiled)(exports, require);
  return exports;
}

async function workbookBuffer() {
  const workbook = new ExcelJS.Workbook();
  const request = workbook.addWorksheet('REQUEST PAYMENT');
  request.addRows([
    ['REQUEST PAYMENT'],
    ['NO REQUEST', 'PPE-001'],
    [],
    ['NRK', 'NAMA', 'NOMINAL'],
    ['', '', 10_000_000],
  ]);
  const closing = workbook.addWorksheet('THP CLOSING');
  closing.addRows([
    ['NO', 'NRK', 'NAMA', 'NAMA CLIENT', 'LOKASI KERJA', 'REGIONAL', 'POSISI', 'NAMA BANK', 'NO REK', ' GAJI POKOK ', ' GROSS ', ' DEDUCT ', ' NETTO '],
    [1, 'EMP-001', 'ARY', 'PT QJOB SAKA GEMILANG', 'JAKARTA', 'DKI Jakarta', 'ENGINEER', 'MANDIRI', '0012345', 3_000_000, 4_000_000, 500_000, 3_500_000],
    [2, 'EMP-002', 'BUDI', 'PT QJOB SAKA GEMILANG', 'BANDUNG', 'Jawa Barat', 'AGENT', 'BRI', '0098765', 2_500_000, 3_000_000, 400_000, 2_600_000],
  ]);
  const bytes = await workbook.xlsx.writeBuffer();
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

test('parser scans all sheets and selects employee datasheet instead of first payment form', async () => {
  const parser = await loadParser();
  const result = await parser.parseIapWorkbook(await workbookBuffer());
  assert.equal(result.rows.length, 2);
  assert.equal(result.sheetName, 'THP CLOSING');
  assert.equal(result.rows[0].nrk, 'EMP-001');
  assert.equal(result.rows[0].client, 'PT QJOB SAKA GEMILANG');
  assert.equal(result.rows[0].basicSalary, 3_000_000);
  assert.equal(result.rows[0].accountNo, '0012345');
  assert.deepEqual(result.payrollSummary, { gross: 7_000_000, deductions: 900_000, net: 6_100_000 });
  assert.equal(result.diagnostics.find((sheet) => sheet.sheetName === 'REQUEST PAYMENT').kind, 'NON_EMPLOYEE_SHEET');
});

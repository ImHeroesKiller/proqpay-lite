export const PAYROLL_TEMPLATE_VERSION = 'PROQPAY_PAYROLL_V1';

export async function downloadPayrollTemplate() {
  const ExcelJS = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'ProQPay';
  workbook.subject = 'Canonical payroll upload template';
  workbook.properties.date1904 = false;

  const payroll = workbook.addWorksheet('01_PAYROLL_DATA', { views: [{ state: 'frozen', ySplit: 1 }] });
  payroll.columns = [
    { header: 'NRK', key: 'nrk', width: 16 },
    { header: 'Nama Karyawan', key: 'name', width: 28 },
    { header: 'Kode Client', key: 'clientCode', width: 14 },
    { header: 'Nama Client', key: 'client', width: 24 },
    { header: 'Nama Cabang', key: 'branch', width: 22 },
    { header: 'Lokasi', key: 'lokasi', width: 22 },
    { header: 'Jabatan', key: 'position', width: 22 },
    { header: 'Status Karyawan', key: 'status', width: 16 },
    { header: 'Nama Bank', key: 'bank', width: 16 },
    { header: 'No Rek', key: 'accountNo', width: 20 },
    { header: 'Gaji Pokok', key: 'basicSalary', width: 16 },
    { header: 'Rapel Gaji', key: 'salaryArrears', width: 15 },
    { header: 'Rapel Tunj', key: 'allowanceArrears', width: 15 },
    { header: 'Lembur', key: 'overtime', width: 14 },
    { header: 'Tunj Jabatan', key: 'positionAllowance', width: 16 },
    { header: 'Tunj Makan', key: 'mealAllowance', width: 15 },
    { header: 'Tunj Transport', key: 'transportAllowance', width: 17 },
    { header: 'Tunj Pulsa', key: 'phoneAllowance', width: 15 },
    { header: 'Tunj Kehadiran', key: 'attendanceAllowance', width: 17 },
    { header: 'Tunj Lain', key: 'otherAllowance', width: 15 },
    { header: 'Insentif', key: 'incentive', width: 14 },
    { header: 'Shift', key: 'shift', width: 14 },
    { header: 'Medical', key: 'medical', width: 14 },
    { header: 'Bonus/ Uang Cuti', key: 'bonusOrLeave', width: 18 },
    { header: 'Tunj Pajak', key: 'taxAllowance', width: 15 },
    { header: 'BPJS TK', key: 'bpjsTk', width: 14 },
    { header: 'BPJS Kes.', key: 'bpjsHealth', width: 14 },
    { header: 'Pot. Kehadiran', key: 'attendanceDeduction', width: 17 },
    { header: 'Pot. JHT', key: 'jhtDeduction', width: 14 },
    { header: 'Pot. Pensiun', key: 'pensionDeduction', width: 16 },
    { header: 'Pot. BPJS Kes', key: 'bpjsHealthDeduction', width: 16 },
    { header: 'Pot. Koperasi', key: 'cooperativeDeduction', width: 16 },
    { header: 'Pot. Pajak', key: 'taxDeduction', width: 14 },
    { header: 'Pot. Lain', key: 'otherDeduction', width: 14 },
    { header: 'Gross', key: 'gross', width: 16 },
    { header: 'Deduct', key: 'deduct', width: 16 },
    { header: 'Netto', key: 'net', width: 16 },
  ];
  payroll.getRow(1).font = { bold: true };
  payroll.autoFilter = { from: 'A1', to: `AK1` };
  payroll.addRow({
    nrk: 'EMP001', name: 'Contoh Karyawan', clientCode: 'CLIENT01', client: 'Nama Klien', branch: 'Jakarta', lokasi: 'Head Office', position: 'Staff', status: 'ACTIVE',
    bank: 'BCA', accountNo: '1234567890', basicSalary: 5000000, overtime: 250000, mealAllowance: 300000,
    jhtDeduction: 100000, bpjsHealthDeduction: 50000, taxDeduction: 100000, gross: 5550000, deduct: 250000, net: 5300000,
  });
  for (let row = 2; row <= 1001; row += 1) {
    for (let col = 11; col <= 37; col += 1) payroll.getCell(row, col).numFmt = '#,##0';
  }

  const reference = workbook.addWorksheet('02_EMPLOYEE_REFERENCE');
  reference.columns = [
    { header: 'Reference Employee ID', key: 'id', width: 22 },
    { header: 'Employee Name Reference', key: 'name', width: 28 },
    { header: 'Project', key: 'project', width: 24 },
    { header: 'Bank Reference', key: 'bank', width: 18 },
    { header: 'Account Reference', key: 'account', width: 22 },
    { header: 'Employment Status', key: 'status', width: 18 },
    { header: 'Catatan', key: 'notes', width: 36 },
  ];
  reference.getRow(1).font = { bold: true };
  reference.addRow({ id: 'Opsional', name: 'Sheet referensi tidak diproses sebagai payroll', notes: 'Gunakan untuk cross-check data employee sebelum upload.' });

  const control = workbook.addWorksheet('03_CONTROL_TOTAL');
  control.columns = [{ header: 'Control', key: 'label', width: 30 }, { header: 'Value', key: 'value', width: 24 }];
  control.getRow(1).font = { bold: true };
  control.addRows([
    { label: 'Template Version', value: PAYROLL_TEMPLATE_VERSION },
    { label: 'Jumlah Employee', value: { formula: "COUNTA('01_PAYROLL_DATA'!A:A)-1" } },
    { label: 'Total Gross', value: { formula: "SUM('01_PAYROLL_DATA'!AI:AI)" } },
    { label: 'Total Deduction', value: { formula: "SUM('01_PAYROLL_DATA'!AJ:AJ)" } },
    { label: 'Total Net/THP', value: { formula: "SUM('01_PAYROLL_DATA'!AK:AK)" } },
    { label: 'Balance Check', value: { formula: 'B4-B5-B6', result: 0 } },
  ]);
  control.getCell('B7').numFmt = '#,##0;[Red]-#,##0';

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'ProQPay-Payroll-Template-v1.xlsx';
  anchor.click();
  URL.revokeObjectURL(url);
}

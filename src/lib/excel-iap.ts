import * as XLSX from 'xlsx';
import { resolveWorkLocation } from './wilayah';

/** Excel serial → YYYY-MM-DD */
export function excelSerialToDate(n: unknown): string | null {
  if (n == null || n === '' || n === '-') return null;
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
};

export function parseIapWorkbook(buffer: ArrayBuffer): {
  rows: ParsedEmployee[];
  sheetName: string;
  totalRaw: number;
  skipped: number;
} {
  const wb = XLSX.read(buffer, { type: 'array' });
  const sheetName = wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });

  const rows: ParsedEmployee[] = [];
  let skipped = 0;

  for (const r of raw) {
    const nrk = String(cell(r, 'NRK', 'nrk') || '').trim();
    const name = String(cell(r, 'Nama Karyawan', 'Nama', 'nama') || '').trim();
    if (!nrk || !name) {
      skipped++;
      continue;
    }

    const lokasi = cell(r, 'Lokasi') != null ? String(cell(r, 'Lokasi')) : null;
    const branch = cell(r, 'Cabang') != null ? String(cell(r, 'Cabang')) : null;
    const kotaUmk = cell(r, 'Kota UMK', 'Kota Umk') != null ? String(cell(r, 'Kota UMK', 'Kota Umk')) : null;
    const unitKerja = cell(r, 'Unit Kerja') != null ? String(cell(r, 'Unit Kerja')) : null;

    const wilayah = resolveWorkLocation({ lokasi: lokasi || undefined, cabang: branch || undefined, kotaUmk: kotaUmk || undefined, unitKerja: unitKerja || undefined });

    const gaji = Number(cell(r, 'Gaji Pokok') || 0);
    const yearRaw = cell(r, 'Tahun Lulus');
    const graduateYear = yearRaw != null && !Number.isNaN(Number(yearRaw)) ? Number(yearRaw) : null;

    rows.push({
      nrk,
      name,
      company: String(cell(r, 'Nama Perusahaan') || 'OTSINDO'),
      client: String(cell(r, 'Klien') || ''),
      clientCode: String(cell(r, 'Kode Klien') || ''),
      birthPlace: cell(r, 'Tempat Lahir') != null ? String(cell(r, 'Tempat Lahir')) : null,
      birthDate: excelSerialToDate(cell(r, 'Tanggal Lahir')),
      gender: cell(r, 'Jenis Kelamin') != null ? String(cell(r, 'Jenis Kelamin')) : null,
      marital: cell(r, 'Status Perkawinan') != null ? String(cell(r, 'Status Perkawinan')) : null,
      ptkpClaimed: cell(r, 'Status PTKP di Akui') != null ? String(cell(r, 'Status PTKP di Akui')) : null,
      ptkpUpdated: cell(r, 'Status PTKP Terupdate') != null ? String(cell(r, 'Status PTKP Terupdate')) : null,
      ktp: cell(r, 'No KTP') != null ? String(cell(r, 'No KTP')) : null,
      address: cell(r, 'Alamat') != null ? String(cell(r, 'Alamat')) : null,
      phone: cell(r, 'No Telp') != null ? String(cell(r, 'No Telp')) : null,
      mobile: cell(r, 'No HP') != null ? String(cell(r, 'No HP')) : null,
      religion: cell(r, 'Agama') != null ? String(cell(r, 'Agama')) : null,
      acceptedDate: excelSerialToDate(cell(r, 'Tanggal Diterima')),
      joinDate: excelSerialToDate(cell(r, 'Tanggal Join')),
      employmentType: cell(r, 'Status Pegawai') != null ? String(cell(r, 'Status Pegawai')) : null,
      contractStatus: cell(r, 'Status') != null ? String(cell(r, 'Status')) : null,
      contractStart: excelSerialToDate(cell(r, 'Awal Kontrak')),
      contractEnd: excelSerialToDate(cell(r, 'Akhir Kontrak')),
      resignDate: excelSerialToDate(cell(r, 'Berhenti')),
      salaryStart: excelSerialToDate(cell(r, 'TMT Gaji')),
      basicSalary: Number.isFinite(gaji) ? Math.round(gaji) : 0,
      branch,
      pic: cell(r, 'PIC') != null ? String(cell(r, 'PIC')) : null,
      lokasi,
      unitKerja,
      position: cell(r, 'Jabatan') != null ? String(cell(r, 'Jabatan')) : null,
      kotaUmk,
      npwp: cell(r, 'No NPWP') != null ? String(cell(r, 'No NPWP')) : null,
      motherName: cell(r, 'Nama Ibu Kandung') != null ? String(cell(r, 'Nama Ibu Kandung')) : null,
      bank: cell(r, 'Bank') != null ? String(cell(r, 'Bank')) : null,
      accountNo: cell(r, 'Rekening') != null ? String(cell(r, 'Rekening')) : null,
      hrisUser: cell(r, 'User') != null ? String(cell(r, 'User')) : null,
      hrbp: cell(r, 'HRBP') != null ? String(cell(r, 'HRBP')) : null,
      bpjsKes: cell(r, 'No. BPJS Kesehatan', 'No BPJS Kesehatan') != null ? String(cell(r, 'No. BPJS Kesehatan', 'No BPJS Kesehatan')) : null,
      bpjsKesEffective: excelSerialToDate(cell(r, 'Tanggal Efektif BPJS')),
      jamsostek: cell(r, 'No. Jamsostek', 'No Jamsostek') != null ? String(cell(r, 'No. Jamsostek', 'No Jamsostek')) : null,
      email: cell(r, 'Alamat Email') != null ? String(cell(r, 'Alamat Email')).trim() : null,
      educationLevel: cell(r, 'Pendidikan') != null ? String(cell(r, 'Pendidikan')) : null,
      school: cell(r, 'Nama Sekolah') != null ? String(cell(r, 'Nama Sekolah')) : null,
      major: cell(r, 'Jurusan') != null ? String(cell(r, 'Jurusan')) : null,
      graduateYear,
      resignReason: cell(r, 'Keterangan Berhenti') != null ? String(cell(r, 'Keterangan Berhenti')) : null,
      candidateSource: cell(r, 'Kandidat') != null ? String(cell(r, 'Kandidat')) : null,
      statusAktif: cell(r, 'Status Pegawai') != null ? String(cell(r, 'Status Pegawai')) : null,
      province: wilayah.province,
      provinceCode: wilayah.provinceCode,
    });
  }

  return { rows, sheetName, totalRaw: raw.length, skipped };
}

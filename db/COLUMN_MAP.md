# Mapping Excel IAP → Schema ProQPay

Sumber: `Data Karyawan Sample - IAP.xlsx` (sheet *Turunan HRIS IAP*)

| Kolom Excel | Tabel | Field |
|-------------|-------|-------|
| NRK | `employees` | `id` |
| Nama Karyawan | `employees` | `name` |
| Nama Perusahaan | `organizations` | `name` (OTSINDO) |
| Klien | `clients` | `name` |
| Kode Klien | `clients` | `code` |
| Tempat Lahir | `employees` | `birth_place` |
| Tanggal Lahir | `employees` | `birth_date` |
| Jenis Kelamin | `employees` | `gender` |
| Status Perkawinan / PTKP | `employee_identity` | `marital_status`, `ptkp_*` |
| No KTP | `employee_identity` | `ktp_no` |
| Alamat | `employee_identity` | `address` |
| No Telp / No HP | `employees` | `phone`, `mobile` |
| Agama | `employees` | `religion` |
| Tanggal Diterima / Join | `employee_contracts` | `accepted_date`, `join_date` |
| Status Pegawai / Status | `employee_contracts` | `employment_type`, `contract_status` |
| Awal/Akhir Kontrak / Berhenti | `employee_contracts` | `contract_start/end`, `resign_date` |
| TMT Gaji / Gaji Pokok | `employee_compensation` | `salary_start`, `basic_salary` |
| Cabang | `branches` | `name` |
| Kota UMK | `branches` | `city_umk` |
| Lokasi / Unit Kerja | `work_locations` | `name`, `unit_kerja` |
| Jabatan | `employee_assignments` | `position` |
| PIC / HRBP | `employee_assignments` | `pic`, `hrbp` |
| No NPWP | `employee_identity` | `npwp_no` |
| Nama Ibu Kandung | `employees` | `mother_name` |
| Bank / Rekening | `employee_bank_accounts` | `bank_name`, `account_no` |
| BPJS Kesehatan / Jamsostek | `employee_bpjs` | `bpjs_kesehatan_no`, `jamsostek_no` |
| Alamat Email | `employees` | `email` |
| Pendidikan / Sekolah / Jurusan / Tahun Lulus | `employee_education` | `level`, `school_name`, `major`, `graduate_year` |
| Keterangan Berhenti / Kandidat | `employee_contracts` | `resign_reason`, `candidate_source` |
| User Input* | `employee_hris_meta` | `input_user`, `fj_*`, `es_*` |
| Status (aktif text) | `employees` | `status_aktif` |

## Relasi

```
organizations 1──* clients
organizations 1──* branches
branches 1──* work_locations
clients 1──* employees
branches 1──* employees
work_locations 1──* employees
employees 1──1 identity / compensation / bpjs / hris_meta
employees 1──* contracts / assignments / bank_accounts / education
```

## Catatan tanggal Excel

Nilai seperti `44389` adalah serial Excel. Konversi ke DATE saat import:

```js
function excelSerialToDate(n) {
  if (!n || isNaN(n)) return null;
  const epoch = new Date(Date.UTC(1899, 11, 30));
  return new Date(epoch.getTime() + Number(n) * 86400000).toISOString().slice(0, 10);
}
```

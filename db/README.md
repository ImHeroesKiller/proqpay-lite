# Database Karyawan

Database menggunakan Netlify Database (Postgres) melalui Drizzle ORM. Data contoh dari lampiran Excel telah dinormalisasi dan dimasukkan melalui migrasi awal.

## Struktur tabel

- `employees`: identitas, biodata, alamat, dan kontak karyawan.
- `employee_tax_profiles`: NPWP, status perkawinan, dan status PTKP.
- `employment_assignments`: perusahaan, klien, lokasi, unit kerja, jabatan, kontrak, dan status kerja.
- `salary_histories`: riwayat gaji pokok berdasarkan tanggal efektif.
- `employee_bank_accounts`: bank dan nomor rekening pembayaran.
- `employee_social_security`: BPJS Kesehatan dan Jamsostek/BPJS Ketenagakerjaan.
- `employee_education`: pendidikan terakhir, sekolah, jurusan, dan tahun lulus.
- `employee_import_metadata`: sumber kandidat serta informasi audit impor.
- `employers`, `clients`, `branches`, `work_locations`, `work_units`, `positions`, dan `banks`: tabel master yang mengurangi pengulangan nilai.

## Pengembangan skema

Ubah `db/schema.ts`, kemudian buat migrasi baru dengan nama yang menjelaskan perubahan:

```bash
npm run db:generate -- --name add_nama_perubahan
```

Netlify menerapkan migrasi dari `netlify/database/migrations` saat deploy. Koneksi aplikasi tersedia melalui ekspor `db` di `db/index.ts` tanpa connection string manual.

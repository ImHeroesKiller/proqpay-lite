'use client';

import { useEffect, useRef, useState } from 'react';

type HelpTab = 'workflow' | 'guide' | 'terms' | 'faq' | 'fixes';
const TABS: Array<{ id: HelpTab; label: string; hint: string }> = [
  { id: 'workflow', label: 'Workflow', hint: 'Urutan proses payroll' },
  { id: 'guide', label: 'User guide', hint: 'Cara menggunakan modul' },
  { id: 'terms', label: 'Daftar istilah', hint: 'Arti istilah di ProQPay' },
  { id: 'faq', label: 'FAQ', hint: 'Pertanyaan yang sering muncul' },
  { id: 'fixes', label: 'Bugs & kendala', hint: 'Solusi cepat saat bermasalah' },
];
const WORKFLOW = [
  ['1', 'Clients & Projects', 'Siapkan klien, project, service tier, periode efektif, serta user yang memiliki akses.'],
  ['2', 'Data Intake', 'Pilih konteks kerja, unduh template, isi data bulanan, unggah, lalu konfirmasi hasil validasi.'],
  ['3', 'Data Readiness', 'Periksa data kosong, format salah, rekening, nominal, dan exception sebelum payroll diproses.'],
  ['4', 'Pay Runs', 'Processor menyiapkan payroll. Controller melakukan review dan mengembalikan data bila perlu.'],
  ['5', 'Payment Instructions', 'Generate PI dari payroll final, submit untuk approval, lalu Controller menyetujui atau menolak.'],
  ['6', 'Payment & Reconciliation', 'Unggah bukti pembayaran, cocokkan nilai transfer, lalu tutup proses setelah matched.'],
  ['7', 'Billing & AR', 'Terbitkan invoice berdasarkan layanan, catat pembayaran, dan pantau saldo piutang.'],
];
const TERMS = [
  ['Data Intake', 'Proses memasukkan data payroll bulanan menggunakan template resmi.'],
  ['Data Readiness', 'Pemeriksaan kelengkapan dan kualitas data sebelum penghitungan payroll.'],
  ['Pay Run', 'Satu proses payroll untuk klien, project, dan periode tertentu.'],
  ['Service Tier', 'Paket layanan yang menentukan fitur dan kontrol yang berlaku pada project.'],
  ['Exception', 'Data atau kondisi yang harus diselesaikan sebelum proses dilanjutkan.'],
  ['Maker–Checker', 'Pemisahan tugas: pembuat transaksi tidak boleh menyetujui transaksi yang sama.'],
  ['Payment Instruction (PI)', 'Instruksi pembayaran final berisi penerima, rekening, dan nominal transfer.'],
  ['Payment Proof', 'Bukti bahwa pembayaran PI telah dijalankan, berupa PDF atau gambar.'],
  ['Reconciliation', 'Pencocokan PI, bukti transfer, jumlah dibayar, dan penerima.'],
  ['Advance Salary / EWA', 'Pengajuan sebagian gaji yang sudah diperoleh sebelum tanggal pembayaran reguler.'],
  ['AR', 'Accounts Receivable atau piutang yang masih harus dibayar oleh klien.'],
  ['ESS', 'Employee Self-Service, portal karyawan untuk status payroll, slip, dan Advance Salary.'],
];

export default function HelpModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [tab, setTab] = useState<HelpTab>('workflow');
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.body.classList.add('modal-open');
    window.addEventListener('keydown', onKey);
    window.setTimeout(() => dialogRef.current?.focus(), 0);
    return () => { document.body.classList.remove('modal-open'); window.removeEventListener('keydown', onKey); previous?.focus(); };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="help-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="help-window" role="dialog" aria-modal="true" aria-labelledby="help-title" ref={dialogRef} tabIndex={-1}>
        <header className="help-header"><div><span>PROQPAY HELP CENTER</span><h2 id="help-title">Panduan penggunaan</h2><p>Panduan praktis untuk menjalankan payroll dengan aman dan teratur.</p></div><button type="button" aria-label="Tutup pusat bantuan" onClick={onClose}>✕</button></header>
        <div className="help-layout">
          <nav className="help-tabs" aria-label="Kategori bantuan">{TABS.map((item) => <button key={item.id} type="button" className={tab === item.id ? 'active' : ''} aria-current={tab === item.id ? 'page' : undefined} onClick={() => setTab(item.id)}><strong>{item.label}</strong><small>{item.hint}</small></button>)}</nav>
          <main className="help-content">
            {tab === 'workflow' ? <HelpSection eyebrow="ALUR UTAMA" title="Workflow payroll dari awal sampai selesai" intro="Ikuti urutan berikut. Tahap berikutnya tersedia setelah kontrol sebelumnya terpenuhi."><div className="help-timeline">{WORKFLOW.map(([number, title, detail]) => <article key={number}><i>{number}</i><div><h3>{title}</h3><p>{detail}</p></div></article>)}</div><Callout title="Prinsip penting">Jangan melewati exception atau melakukan approval dengan akun pembuat transaksi. Sistem menyimpan jejak setiap tindakan untuk audit.</Callout></HelpSection> : null}
            {tab === 'guide' ? <HelpSection eyebrow="USER GUIDE" title="Cara menggunakan ProQPay" intro="Menu dan tombol yang terlihat menyesuaikan role Anda."><div className="help-card-grid"><GuideCard title="Payroll Processor" items={['Kelola klien, project, karyawan, dan Data Intake.', 'Perbaiki exception dan siapkan Pay Run.', 'Generate lalu submit Payment Instruction.']} /><GuideCard title="Payroll Controller" items={['Review hasil payroll dan alasan perubahan.', 'Approve atau kembalikan payroll/PI.', 'Periksa bukti bayar dan rekonsiliasi.']} /><GuideCard title="Client User" items={['Unggah data untuk scope klien yang diberikan.', 'Menindaklanjuti exception dari tim payroll.', 'Memantau status payroll, pembayaran, dan laporan.']} /><GuideCard title="Super Admin" items={['Memiliki visibilitas seluruh workflow.', 'Mengelola user, role, integrasi, dan pengaturan.', 'Tindakan destruktif tetap memerlukan konfirmasi khusus.']} /></div><h3 className="help-subtitle">Kebiasaan kerja yang disarankan</h3><ul className="help-list"><li>Pastikan periode dan konteks klien/project benar sebelum mengunggah data.</li><li>Baca balon informasi atau error karena menjelaskan tindakan yang diperlukan.</li><li>Gunakan Search untuk berpindah modul dan Audit Logs untuk memeriksa histori.</li><li>Jangan membagikan password atau file berisi data personal melalui kanal publik.</li></ul></HelpSection> : null}
            {tab === 'terms' ? <HelpSection eyebrow="GLOSSARY" title="Daftar istilah" intro="Istilah yang paling sering digunakan di aplikasi."><dl className="help-glossary">{TERMS.map(([term, meaning]) => <div key={term}><dt>{term}</dt><dd>{meaning}</dd></div>)}</dl></HelpSection> : null}
            {tab === 'faq' ? <HelpSection eyebrow="FAQ" title="Pertanyaan yang sering diajukan" intro="Klik pertanyaan untuk melihat jawabannya."><div className="help-faq"><Faq question="Mengapa tombol proses atau approval tidak muncul?">Tombol mengikuti role, status workflow, service tier, dan kelengkapan data. Periksa role, Data Readiness, serta status record.</Faq><Faq question="Mengapa file Data Intake ditolak?">Gunakan template terbaru, jangan mengubah nama kolom wajib, pilih konteks lengkap, dan pastikan format tanggal serta nominal sesuai.</Faq><Faq question="Apakah data karyawan langsung berubah setelah upload?">Belum. File masuk tahap validasi dan baru diterapkan setelah hasil diperiksa serta dikonfirmasi.</Faq><Faq question="Kapan slip gaji muncul di ESS?">Slip final tersedia setelah Payment Instruction selesai dan rekonsiliasi matched. Estimasi tidak ditampilkan sebagai slip final.</Faq><Faq question="Siapa yang dapat menyetujui payroll dan pembayaran?">Payroll Controller melakukan review/approval. Pembuat transaksi tidak dapat menyetujui transaksinya sendiri.</Faq><Faq question="Bagaimana melihat histori aktivitas?">Buka Audit & Portal Logs, lalu gunakan tab dan filter untuk mencari aktivitas yang diperlukan.</Faq></div></HelpSection> : null}
            {tab === 'fixes' ? <HelpSection eyebrow="TROUBLESHOOTING" title="Bugs dan solusi cepat" intro="Coba langkah berikut sebelum mengulangi transaksi."><div className="help-fix-list"><Fix title="Upload berhenti atau gagal" steps="Pastikan jenis dan ukuran file sesuai, koneksi stabil, lalu pilih ulang file dan unggah sekali lagi." /><Fix title="Pilihan sudah diisi tetapi dianggap kosong" steps="Klik ulang klien, project, periode, dan tier; tunggu data selesai dimuat. Jangan memakai dua tab untuk form yang sama." /><Fix title="Data atau status belum berubah" steps="Tutup modal, muat ulang halaman, lalu periksa Audit Logs. Hindari menekan submit berulang kali." /><Fix title="Tidak dapat login atau session berakhir" steps="Masuk kembali dengan kredensial terbaru. Jika terkunci, tunggu 15 menit atau minta admin mereset password." /><Fix title="Menu tidak terlihat" steps="Menu mengikuti role dan scope. Minta Super Admin memeriksa role, status user, serta penugasan klien/project." /><Fix title="Masalah masih terjadi" steps="Catat waktu, halaman, langkah terakhir, dan pesan error. Sertakan screenshot tanpa data sensitif kepada administrator." /></div><Callout title="Hindari kehilangan data">Jangan menutup halaman ketika indikator “Menyimpan” atau “Mengunggah” masih berjalan. Periksa hasil dan Audit Logs sebelum mengulang.</Callout></HelpSection> : null}
          </main>
        </div>
        <footer className="help-footer"><span>Butuh navigasi cepat? Gunakan <kbd>Search</kbd> di header atau <strong>Ask IDA</strong>.</span><button type="button" className="btn btn-primary" onClick={onClose}>Selesai</button></footer>
      </div>
    </div>
  );
}

function HelpSection({ eyebrow, title, intro, children }: { eyebrow: string; title: string; intro: string; children: React.ReactNode }) { return <section className="help-section"><span>{eyebrow}</span><h2>{title}</h2><p>{intro}</p>{children}</section>; }
function GuideCard({ title, items }: { title: string; items: string[] }) { return <article className="help-guide-card"><h3>{title}</h3><ul>{items.map((item) => <li key={item}>{item}</li>)}</ul></article>; }
function Faq({ question, children }: { question: string; children: React.ReactNode }) { return <details><summary>{question}<span>+</span></summary><p>{children}</p></details>; }
function Fix({ title, steps }: { title: string; steps: string }) { return <article><span>!</span><div><h3>{title}</h3><p>{steps}</p></div></article>; }
function Callout({ title, children }: { title: string; children: React.ReactNode }) { return <aside className="help-callout"><strong>{title}</strong><p>{children}</p></aside>; }

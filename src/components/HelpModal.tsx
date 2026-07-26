'use client';

import { useEffect } from 'react';

export default function HelpModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 310,
        background: 'rgba(15,23,42,0.45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
      }}
    >
      <div
        style={{
          background: 'var(--bg-surface)',
          borderRadius: 16,
          border: '1px solid var(--border)',
          width: '100%',
          maxWidth: 480,
          padding: 24,
          maxHeight: '80vh',
          overflowY: 'auto',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0 }}>Bantuan</h3>
          <button type="button" className="btn" onClick={onClose}>
            ✕
          </button>
        </div>
        <div style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--text2)', marginTop: 14 }}>
          <p>
            <strong>Dashboard</strong> menampilkan ringkasan. Klik kartu untuk melihat detail.
          </p>
          <p>
            Semua proses (upload data, hitung gaji, invoice) dilakukan lewat <strong>Ask IDA</strong> di pojok kanan bawah.
          </p>
          <p>Menu samping:
            <br />• Karyawan & Klien — daftar data
            <br />• Laporan — ringkasan payroll & piutang
            <br />• Pengaturan — tampilan, variabel biaya, pengguna
          </p>
          <p>Di chat IDA, ketik <strong>help</strong> untuk daftar perintah.</p>
        </div>
      </div>
    </div>
  );
}

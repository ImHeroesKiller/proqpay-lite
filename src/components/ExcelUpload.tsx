'use client';

import { useState, useRef } from 'react';
import type { ParsedEmployee } from '@/lib/excel-iap';
import { downloadPayrollTemplate } from '@/lib/payroll-template';

export default function ExcelUpload() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<ParsedEmployee[] | null>(null);
  const [meta, setMeta] = useState<{ sheetName: string; totalRaw: number; skipped: number } | null>(null);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  async function onFile(file: File) {
    setError(null);
    setResult(null);
    setBusy(true);
    try {
      if (file.size > 5 * 1024 * 1024) {
        throw new Error('Ukuran file maksimal 5 MB');
      }
      const buf = await file.arrayBuffer();
      const { parseIapWorkbook } = await import('@/lib/excel-iap');
      const parsed = await parseIapWorkbook(buf);
      setPreview(parsed.rows.slice(0, 8));
      setMeta({ sheetName: parsed.sheetName, totalRaw: parsed.totalRaw, skipped: parsed.skipped });
      (window as any).__iap_rows = parsed.rows;
    } catch (e: any) {
      setError(e?.message || 'Gagal parse Excel');
      setPreview(null);
    } finally {
      setBusy(false);
    }
  }

  async function doImport() {
    const rows = (window as any).__iap_rows as ParsedEmployee[] | undefined;
    if (!rows?.length) {
      setError('Belum ada data ter-parse');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const chunkSize = 40;
      let inserted = 0;
      let updated = 0;
      let errors = 0;
      const provinceStats: Record<string, number> = {};

      for (let i = 0; i < rows.length; i += chunkSize) {
        const chunk = rows.slice(i, i + chunkSize);
        const res = await fetch('/api/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rows: chunk }),
        });
        const data = await res.json();
        if (!res.ok || data.error) {
          throw new Error(data.error || data.message || `HTTP ${res.status}`);
        }
        inserted += data.inserted || 0;
        updated += data.updated || 0;
        errors += data.errors || 0;
        if (data.provinceStats) {
          for (const [k, v] of Object.entries(data.provinceStats)) {
            provinceStats[k] = (provinceStats[k] || 0) + (v as number);
          }
        }
      }

      setResult({ inserted, updated, errors, provinceStats, total: rows.length });
    } catch (e: any) {
      setError(e?.message || 'Import gagal');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ padding: '20px', marginBottom: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px', marginBottom: '12px', flexWrap: 'wrap' }}>
        <div>
          <h3 style={{ fontSize: '14px', fontWeight: 700, marginBottom: '4px' }}>Import HRIS / Payroll Excel</h3>
          <p style={{ fontSize: '12px', color: 'var(--text3)', margin: 0 }}>
            Gunakan template ProQPay v1 untuk source payroll final yang konsisten dan dapat direkonsiliasi.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            onClick={() => void downloadPayrollTemplate()}
            style={{ padding: '8px 14px', borderRadius: 'var(--r-md)', border: '1px solid var(--border)', background: 'var(--bg-subtle)', fontWeight: 650, fontSize: '12px', cursor: 'pointer' }}
          >
            Unduh Template Payroll v1
          </button>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={busy}
            style={{ padding: '8px 14px', borderRadius: 'var(--r-md)', border: '1px solid var(--border)', background: 'var(--bg-surface)', fontWeight: 650, fontSize: '12px', cursor: busy ? 'wait' : 'pointer' }}
          >
            {busy ? 'Memproses…' : 'Pilih file'}
          </button>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xls"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onFile(f);
            e.target.value = '';
          }}
        />
      </div>

      {meta && (
        <p style={{ fontSize: '12px', color: 'var(--text2)', marginBottom: '10px' }}>
          Sheet <strong>{meta.sheetName}</strong> · {meta.totalRaw} baris · skip {meta.skipped} · siap{' '}
          <strong>{(window as any).__iap_rows?.length || 0}</strong>
        </p>
      )}

      {preview && preview.length > 0 && (
        <div style={{ overflowX: 'auto', marginBottom: '12px' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11.5px' }}>
            <thead><tr style={{ textAlign: 'left', color: 'var(--text3)' }}><th style={{ padding: '6px 8px' }}>NRK</th><th style={{ padding: '6px 8px' }}>Nama</th><th style={{ padding: '6px 8px' }}>Lokasi</th><th style={{ padding: '6px 8px' }}>Provinsi</th><th style={{ padding: '6px 8px' }}>Gaji</th></tr></thead>
            <tbody>{preview.map((r) => <tr key={r.nrk} style={{ borderTop: '1px solid var(--border-soft)' }}><td style={{ padding: '6px 8px' }}>{r.nrk}</td><td style={{ padding: '6px 8px' }}>{r.name}</td><td style={{ padding: '6px 8px' }}>{r.lokasi || r.branch}</td><td style={{ padding: '6px 8px', fontWeight: 650 }}>{r.province}</td><td style={{ padding: '6px 8px' }}>{r.basicSalary?.toLocaleString('id-ID')}</td></tr>)}</tbody>
          </table>
        </div>
      )}

      {preview && (
        <button type="button" onClick={doImport} disabled={busy} style={{ padding: '10px 16px', borderRadius: 'var(--r-md)', border: 'none', background: 'linear-gradient(135deg, var(--accent), var(--accent2))', color: 'var(--accent-contrast)', fontWeight: 700, fontSize: '13px', cursor: busy ? 'wait' : 'pointer' }}>
          {busy ? 'Mengimpor ke Cloudflare D1…' : 'Import ke database'}
        </button>
      )}

      {error && <p style={{ marginTop: '10px', fontSize: '12px', color: 'var(--error)' }}>{error}</p>}
      {result && <div style={{ marginTop: '12px', fontSize: '12px', color: 'var(--text2)' }}><strong style={{ color: 'var(--success)' }}>Import selesai</strong><br />Baru: {result.inserted} · Update: {result.updated} · Error: {result.errors} · Total: {result.total}<br />Provinsi: {Object.entries(result.provinceStats || {}).map(([k, v]) => `${k} (${v})`).join(' · ')}</div>}
    </div>
  );
}

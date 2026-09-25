'use client';

import { useEffect, useState } from 'react';
import type { EmployeeActor, PortalCredentialRow, PortalCredentialSummary } from '@/lib/employee-ui';
import { canManageEmployees } from '@/lib/employee-ui';

function downloadPortalCsv(rows: PortalCredentialRow[]) {
  const header = 'employee_id,employee_code,name,project,password';
  const escape = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`;
  const body = rows.map((row) => [row.employeeId, row.employeeCode, row.name, row.projectCode, row.password].map(escape).join(',')).join('\n');
  const blob = new Blob([`${header}\n${body}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `proqpay-ess-passwords-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

export default function EmployeeCredentialsPanel({ actor }: { actor: EmployeeActor | null }) {
  const canIssue = canManageEmployees(actor);
  const [summary, setSummary] = useState<PortalCredentialSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [issued, setIssued] = useState<PortalCredentialRow[]>([]);
  const [panelOpen, setPanelOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  async function loadSummary() {
    if (!canIssue || loading) return;
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/employee-credentials', { headers: { Accept: 'application/json' } });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.ok) throw new Error(data.error || 'Status akses ESS tidak dapat dimuat');
      setSummary({ total: data.total, issued: data.issued, pending: data.pending, formula: data.formula });
    } catch (cause) {
      setSummary(null);
      setError(cause instanceof Error ? cause.message : 'Status akses ESS tidak dapat dimuat');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!canIssue) return;
    void loadSummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canIssue]);

  useEffect(() => {
    if (!confirmOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) setConfirmOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [confirmOpen, busy]);

  if (!canIssue) return null;

  async function issueAll() {
    if (busy) return;
    setBusy(true);
    setError('');
    setIssued([]);
    try {
      const collected: PortalCredentialRow[] = [];
      let remaining = 1;
      while (remaining > 0) {
        const response = await fetch('/api/employee-credentials', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'ISSUE' }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
        collected.push(...(data.issued || []));
        remaining = Number(data.remaining || 0);
        setSummary({ total: data.total, issued: data.issuedCount, pending: remaining, formula: 'RANDOM_TEMPORARY' });
        if (!data.processed) break;
      }
      setIssued(collected);
      setConfirmOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Gagal menerbitkan password portal');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="btn employee-ess-trigger"
        onClick={() => setPanelOpen(true)}
        aria-haspopup="dialog"
      >
        Kelola akses ESS
      </button>

      {panelOpen ? (
        <div className="employee-confirm-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setPanelOpen(false); }}>
          <section className="card employee-ess-modal" role="dialog" aria-modal="true" aria-labelledby="employee-ess-title">
            <div className="employee-ess-modal-head">
              <div>
                <span className="page-eyebrow">Credential ESS</span>
                <h2 id="employee-ess-title">Kelola akses portal karyawan</h2>
                <p>Password sementara acak · wajib diganti saat login pertama. Plaintext tidak disimpan.</p>
              </div>
              <button type="button" className="btn" onClick={() => setPanelOpen(false)} aria-label="Tutup pengelolaan akses ESS">✕</button>
            </div>

            <div className="employee-confirm-stats">
              <div><span>Total karyawan</span><strong>{summary?.total ?? '—'}</strong></div>
              <div><span>Sudah diterbitkan</span><strong>{summary?.issued ?? '—'}</strong></div>
              <div><span>Belum diterbitkan</span><strong>{summary?.pending ?? '—'}</strong></div>
            </div>

            {error ? <div className="employee-ess-error" role="alert"><span>{error}</span><button type="button" className="btn" disabled={loading} onClick={() => void loadSummary()}>{loading?'Memuat…':'Coba lagi'}</button></div> : null}

            <div className="employee-ess-modal-actions">
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy || loading || summary == null || summary.pending === 0}
                onClick={() => setConfirmOpen(true)}
              >
                {busy ? 'Menerbitkan…' : loading ? 'Memuat status…' : summary == null ? 'Status belum tersedia' : 'Terbitkan password'}
              </button>
            </div>

            {issued.length ? (
              <div className="portal-credentials-issued">
                <div>
                  <strong>{issued.length} password — hanya batch ini</strong>
                  <button type="button" className="btn" onClick={() => downloadPortalCsv(issued)}>Unduh CSV</button>
                </div>
                <pre>{issued.slice(0, 8).map((row) => `${row.employeeCode}\t${row.password}`).join('\n')}{issued.length > 8 ? `\n… ${issued.length - 8} lainnya di CSV` : ''}</pre>
              </div>
            ) : null}
          </section>
        </div>
      ) : null}

      {confirmOpen ? (
        <div className="employee-confirm-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setConfirmOpen(false); }}>
          <section className="card employee-confirm-modal" role="dialog" aria-modal="true" aria-labelledby="employee-credential-confirm-title">
            <span className="page-eyebrow">Credential ESS</span>
            <h2 id="employee-credential-confirm-title">Terbitkan password sementara?</h2>
            <p>Password acak akan dibuat untuk seluruh karyawan aktif yang belum memiliki credential. Password hanya ditampilkan pada batch ini dan wajib diganti saat login pertama.</p>
            <div className="employee-confirm-stats">
              <div><span>Total</span><strong>{summary?.total ?? '—'}</strong></div>
              <div><span>Belum diterbitkan</span><strong>{summary?.pending ?? '—'}</strong></div>
            </div>
            <div className="employee-confirm-actions">
              <button type="button" className="btn" disabled={busy} onClick={() => setConfirmOpen(false)}>Batal</button>
              <button type="button" className="btn btn-primary" disabled={busy || summary == null} onClick={() => void issueAll()}>{busy ? 'Menerbitkan…' : 'Ya, terbitkan'}</button>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}

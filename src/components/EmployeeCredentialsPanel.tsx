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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [issued, setIssued] = useState<PortalCredentialRow[]>([]);
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    if (!canIssue) return;
    fetch('/api/employee-credentials', { headers: { Accept: 'application/json' } })
      .then((response) => response.json())
      .then((data) => {
        if (data?.ok) setSummary({ total: data.total, issued: data.issued, pending: data.pending, formula: data.formula });
      })
      .catch(() => {});
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
      <div className="portal-credentials-card card">
        <div>
          <strong>Password portal ESS</strong>
          <span>Password sementara acak · wajib diganti saat login pertama. Plaintext tidak disimpan.</span>
        </div>
        <div className="portal-credentials-meta">
          <span>Karyawan {summary?.total ?? '—'}</span>
          <span>Sudah {summary?.issued ?? '—'}</span>
          <span>Belum {summary?.pending ?? '—'}</span>
        </div>
        <button type="button" className="btn btn-primary" disabled={busy || summary?.pending === 0} onClick={() => setConfirmOpen(true)}>
          {busy ? 'Menerbitkan…' : 'Terbitkan password portal'}
        </button>
        {error ? <p className="portal-credentials-error">{error}</p> : null}
        {issued.length ? (
          <div className="portal-credentials-issued">
            <div>
              <strong>{issued.length} password — hanya batch ini</strong>
              <button type="button" className="btn" onClick={() => downloadPortalCsv(issued)}>Unduh CSV</button>
            </div>
            <pre>{issued.slice(0, 8).map((row) => `${row.employeeCode}\t${row.password}`).join('\n')}{issued.length > 8 ? `\n… ${issued.length - 8} lainnya di CSV` : ''}</pre>
          </div>
        ) : null}
      </div>

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
              <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void issueAll()}>{busy ? 'Menerbitkan…' : 'Ya, terbitkan'}</button>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}

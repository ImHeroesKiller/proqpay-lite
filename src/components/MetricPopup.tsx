'use client';

import { useState, useEffect } from 'react';
import { formatIDR, formatIDRShort } from '@/lib/format';

type PopupType = 'employees' | 'clients' | 'payroll' | 'outstanding' | null;

interface MetricPopupProps {
  type: PopupType;
  db: any;
  onClose: () => void;
}

export default function MetricPopup({ type, db, onClose }: MetricPopupProps) {
  const [search, setSearch] = useState('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!type) return null;

  let title = '';
  let headers: string[] = [];
  let rows: string[][] = [];

  switch (type) {
    case 'employees':
      title = 'Karyawan';
      headers = ['ID', 'Nama', 'Klien', 'Jabatan', 'Status', 'Wilayah', 'Gaji'];
      rows = (db.employees || []).map((e: any) => [
        e.id,
        e.name,
        e.company,
        e.position || '-',
        e.status,
        e.region || '-',
        formatIDR(e.salaryGross),
      ]);
      break;
    case 'clients':
      title = 'Klien';
      headers = ['ID', 'Nama', 'NPWP', 'PIC', 'Telepon', 'Tipe'];
      rows = (db.companies || []).map((c: any) => [
        c.id,
        c.name,
        c.npwp || '-',
        c.pic || '-',
        c.phone || '-',
        c.payrollType,
      ]);
      break;
    case 'payroll':
      title = 'Payroll';
      headers = ['ID', 'Periode', 'Status', 'Karyawan', 'Gross', 'Net'];
      rows = (db.payrolls || []).map((p: any) => [
        p.id,
        p.period,
        p.status,
        String(p.summary?.employeeCount || 0),
        formatIDRShort(p.summary?.totalGross || 0),
        formatIDRShort(p.summary?.totalNet || 0),
      ]);
      break;
    case 'outstanding':
      title = 'Piutang';
      headers = ['ID', 'Klien', 'Invoice', 'Nominal', 'Status', 'Hari'];
      rows = (db.arMonitor || []).map((a: any) => [
        a.id,
        a.company,
        a.invoiceId,
        formatIDRShort(a.amount),
        a.status,
        String(a.daysOverdue || 0),
      ]);
      break;
  }

  const q = search.toLowerCase();
  const filtered = rows.filter((r) => r.some((c) => String(c).toLowerCase().includes(q)));

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 280,
        background: 'rgba(15, 23, 42, 0.5)',
        backdropFilter: 'blur(6px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
      }}
    >
      <div
        style={{
          background: 'var(--bg-surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--r-xl)',
          boxShadow: 'var(--shadow-lg)',
          width: '100%',
          maxWidth: 720,
          maxHeight: '80vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          position: 'relative',
          zIndex: 281,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '16px 20px',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>{title}</h3>
          <button
            type="button"
            onClick={onClose}
            style={{
              width: 32,
              height: 32,
              borderRadius: 'var(--r-sm)',
              border: '1px solid var(--border)',
              background: 'var(--bg-surface)',
              cursor: 'pointer',
            }}
          >
            ✕
          </button>
        </div>

        <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--border-soft)' }}>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari…"
            autoFocus
            style={{
              width: '100%',
              padding: '10px 14px',
              background: 'var(--bg-subtle)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--r-md)',
              fontSize: 13,
              fontFamily: 'inherit',
              color: 'var(--text)',
              outline: 'none',
            }}
          />
        </div>

        <div style={{ flex: 1, overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead>
              <tr>
                {headers.map((h) => (
                  <th
                    key={h}
                    style={{
                      textAlign: 'left',
                      padding: '10px 16px',
                      background: 'var(--bg-subtle)',
                      color: 'var(--text2)',
                      fontWeight: 600,
                      fontSize: 11,
                      textTransform: 'uppercase',
                      position: 'sticky',
                      top: 0,
                      zIndex: 2,
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={headers.length} style={{ padding: 24, textAlign: 'center', color: 'var(--text3)' }}>
                    Tidak ada data
                  </td>
                </tr>
              ) : (
                filtered.map((r, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid var(--border-soft)' }}>
                    {r.map((c, j) => (
                      <td key={j} style={{ padding: '9px 16px', whiteSpace: 'nowrap' }}>
                        {j === 0 ? <strong>{c}</strong> : c}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div style={{ padding: '10px 20px', borderTop: '1px solid var(--border-soft)', fontSize: 12, color: 'var(--text3)' }}>
          {filtered.length} / {rows.length}
        </div>
      </div>
    </div>
  );
}

'use client';

import { useEffect, useState } from 'react';
import {
  loadSettings,
  saveSettings,
  type AppSettings,
  type AppRole,
  type AppUser,
} from '@/lib/app-settings';

type Tab = 'umum' | 'tampilan' | 'variabel' | 'users';

export default function SettingsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('umum');
  const [s, setS] = useState<AppSettings | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (open) {
      setS(loadSettings());
      setSaved(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open || !s) return null;

  function patch(p: Partial<AppSettings>) {
    setS((prev) => (prev ? { ...prev, ...p } : prev));
    setSaved(false);
  }

  function save() {
    if (!s) return;
    saveSettings(s);
    setSaved(true);
  }

  function updateUser(id: string, p: Partial<AppUser>) {
    patch({ users: s.users.map((u) => (u.id === id ? { ...u, ...p } : u)) });
  }

  function addUser() {
    const id = `U${Date.now().toString(36)}`;
    patch({
      users: [
        ...s.users,
        { id, name: 'User Baru', email: `user${s.users.length + 1}@proqpay.id`, role: 'VIEWER', active: true },
      ],
    });
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: 'umum', label: 'Umum' },
    { id: 'tampilan', label: 'Tampilan' },
    { id: 'variabel', label: 'Variabel' },
    { id: 'users', label: 'Users & Roles' },
  ];

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 300,
        background: 'rgba(15, 23, 42, 0.5)',
        backdropFilter: 'blur(6px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px',
      }}
    >
      <div
        style={{
          background: 'var(--bg-surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--r-xl)',
          boxShadow: 'var(--shadow-lg)',
          width: '100%',
          maxWidth: '640px',
          maxHeight: '88vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
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
          <h3 style={{ fontSize: '16px', fontWeight: 700, margin: 0 }}>Pengaturan</h3>
          <button type="button" onClick={onClose} className="btn" style={{ width: 32, height: 32, padding: 0 }}>
            ✕
          </button>
        </div>

        <div style={{ display: 'flex', gap: 4, padding: '10px 16px', borderBottom: '1px solid var(--border-soft)' }}>
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              style={{
                border: 'none',
                borderRadius: 999,
                padding: '6px 12px',
                fontSize: 12,
                fontWeight: 650,
                cursor: 'pointer',
                background: tab === t.id ? 'var(--accent-soft)' : 'transparent',
                color: tab === t.id ? 'var(--accent)' : 'var(--text2)',
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div style={{ padding: 20, overflowY: 'auto', flex: 1 }}>
          {tab === 'umum' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <Field label="Nama organisasi">
                <input value={s.orgName} onChange={(e) => patch({ orgName: e.target.value })} style={inp} />
              </Field>
              <Field label="Periode default (YYYY-MM)">
                <input value={s.defaultPeriod} onChange={(e) => patch({ defaultPeriod: e.target.value })} style={inp} />
              </Field>
              <Field label="Pengguna aktif">
                <select
                  value={s.currentUserId}
                  onChange={(e) => patch({ currentUserId: e.target.value })}
                  style={inp}
                >
                  {s.users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name} ({u.role})
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          )}

          {tab === 'tampilan' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <Field label="Kepadatan">
                <select
                  value={s.density}
                  onChange={(e) => patch({ density: e.target.value as AppSettings['density'] })}
                  style={inp}
                >
                  <option value="comfortable">Nyaman</option>
                  <option value="compact">Padat</option>
                </select>
              </Field>
              <Toggle
                label="Tampilkan grafik kecil"
                checked={s.showSparklines}
                onChange={(v) => patch({ showSparklines: v })}
              />
              <Toggle label="Tampilkan peta" checked={s.showMap} onChange={(v) => patch({ showMap: v })} />
              <Toggle
                label="Tampilkan detail klien"
                checked={s.showClientDetail}
                onChange={(v) => patch({ showClientDetail: v })}
              />
              <Toggle
                label="Tampilkan alur berpikir IDA"
                checked={s.idaShowCot}
                onChange={(v) => patch({ idaShowCot: v })}
              />
              <Field label={`Kecepatan ketik IDA (${s.idaTypingMs} ms/karakter)`}>
                <input
                  type="range"
                  min={10}
                  max={60}
                  value={s.idaTypingMs}
                  onChange={(e) => patch({ idaTypingMs: Number(e.target.value) })}
                  style={{ width: '100%' }}
                />
              </Field>
            </div>
          )}

          {tab === 'variabel' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <Field label="Biaya jasa / karyawan (Rp)">
                <input
                  type="number"
                  value={s.serviceFeePerEmp}
                  onChange={(e) => patch({ serviceFeePerEmp: Number(e.target.value) || 0 })}
                  style={inp}
                />
              </Field>
              <Field label="Biaya kelola BPJS / karyawan (Rp)">
                <input
                  type="number"
                  value={s.bpjsFeePerEmp}
                  onChange={(e) => patch({ bpjsFeePerEmp: Number(e.target.value) || 0 })}
                  style={inp}
                />
              </Field>
              <Field label="Biaya administrasi (Rp)">
                <input
                  type="number"
                  value={s.adminFee}
                  onChange={(e) => patch({ adminFee: Number(e.target.value) || 0 })}
                  style={inp}
                />
              </Field>
              <p style={{ fontSize: 12, color: 'var(--text3)', margin: 0 }}>
                Variabel ini dipakai saat membuat invoice dan estimasi margin.
              </p>
            </div>
          )}

          {tab === 'users' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {s.users.map((u) => (
                <div
                  key={u.id}
                  style={{
                    border: '1px solid var(--border)',
                    borderRadius: 12,
                    padding: 12,
                    background: 'var(--bg-subtle)',
                  }}
                >
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    <input value={u.name} onChange={(e) => updateUser(u.id, { name: e.target.value })} style={inp} />
                    <input value={u.email} onChange={(e) => updateUser(u.id, { email: e.target.value })} style={inp} />
                    <select
                      value={u.role}
                      onChange={(e) => updateUser(u.id, { role: e.target.value as AppRole })}
                      style={inp}
                    >
                      {(['SUPER_ADMIN', 'PAYROLL', 'HR', 'FINANCE', 'DIRECTOR', 'VIEWER'] as AppRole[]).map(
                        (r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        )
                      )}
                    </select>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                      <input
                        type="checkbox"
                        checked={u.active}
                        onChange={(e) => updateUser(u.id, { active: e.target.checked })}
                      />
                      Aktif
                    </label>
                  </div>
                </div>
              ))}
              <button type="button" className="btn" onClick={addUser}>
                + Tambah pengguna
              </button>
            </div>
          )}
        </div>

        <div
          style={{
            padding: '14px 20px',
            borderTop: '1px solid var(--border)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <span style={{ fontSize: 12, color: saved ? 'var(--success)' : 'var(--text3)' }}>
            {saved ? 'Tersimpan' : 'Belum disimpan'}
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn" onClick={onClose}>
              Tutup
            </button>
            <button type="button" className="btn btn-primary" onClick={save}>
              Simpan
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text2)', display: 'block', marginBottom: 6 }}>
        {label}
      </label>
      {children}
    </div>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 13 }}>
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

const inp: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  background: 'var(--bg-subtle)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--r-sm)',
  fontSize: 13,
  fontFamily: 'inherit',
  color: 'var(--text)',
  outline: 'none',
};

'use client';

import { useEffect, useState } from 'react';
import {
  loadSettings,
  saveSettings,
  type AppSettings,
  type AppRole,
  type AppUser,
} from '@/lib/app-settings';
import { saveDatabase, seedDatabase } from '@/lib/database';
import { emitDbChange } from '@/lib/events';
import { writeSystemLog } from '@/lib/system-log';

type Tab = 'umum' | 'tampilan' | 'variabel' | 'users' | 'data';

const RESET_CONFIRMATION = 'HAPUS SEMUA DATA';

export default function SettingsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('umum');
  const [s, setS] = useState<AppSettings | null>(null);
  const [saved, setSaved] = useState(false);
  const [resetConfirmation, setResetConfirmation] = useState('');
  const [resetting, setResetting] = useState(false);
  const [resetStatus, setResetStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    if (open) {
      setS(loadSettings());
      setSaved(false);
      setResetConfirmation('');
      setResetStatus(null);
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
    if (!s) return;
    patch({ users: s.users.map((u) => (u.id === id ? { ...u, ...p } : u)) });
  }

  function addUser() {
    if (!s) return;
    const id = `U${Date.now().toString(36)}`;
    patch({
      users: [
        ...s.users,
        { id, name: 'User Baru', email: `user${s.users.length + 1}@proqpay.id`, role: 'VIEWER', active: true },
      ],
    });
  }

  async function resetOperationalData() {
    if (resetConfirmation !== RESET_CONFIRMATION || resetting) return;
    setResetting(true);
    setResetStatus(null);
    writeSystemLog('WARN', 'SECURITY', 'SETTINGS_RESET_REQUESTED', 'Reset data operasional diminta dari Pengaturan');
    try {
      const response = await fetch('/api/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmation: RESET_CONFIRMATION }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || data.message || `HTTP ${response.status}`);
      }
      const emptyDb = seedDatabase();
      saveDatabase(emptyDb);
      emitDbChange();
      setResetConfirmation('');
      setResetStatus({
        type: 'success',
        message: `Reset selesai: ${data.deleted?.employees || 0} karyawan, ${data.deleted?.clients || 0} klien, ${data.deleted?.payrolls || 0} payroll, dan ${data.deleted?.invoices || 0} invoice dihapus.`,
      });
      writeSystemLog('SUCCESS', 'SECURITY', 'SETTINGS_RESET_COMPLETED', 'Reset data operasional selesai', {
        deleted: data.deleted,
        preserved: data.preserved,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Reset gagal';
      setResetStatus({ type: 'error', message: `Reset gagal: ${message}. Tidak ada data lokal yang diubah.` });
      writeSystemLog('ERROR', 'SECURITY', 'SETTINGS_RESET_REJECTED', message);
    } finally {
      setResetting(false);
    }
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: 'umum', label: 'Umum' },
    { id: 'tampilan', label: 'Tampilan' },
    { id: 'variabel', label: 'Variabel' },
    { id: 'users', label: 'Users & Roles' },
    { id: 'data', label: 'Data' },
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
                      {(['SUPER_ADMIN', 'PAYROLL_PROCESSOR', 'PAYROLL_CONTROLLER', 'CLIENT_USER', 'PAYROLL', 'HR', 'FINANCE', 'DIRECTOR', 'VIEWER'] as AppRole[]).map(
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

          {tab === 'data' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div
                style={{
                  border: '1px solid rgba(220, 38, 38, 0.28)',
                  borderRadius: 14,
                  padding: 16,
                  background: 'rgba(220, 38, 38, 0.045)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                  <span
                    aria-hidden="true"
                    style={{
                      width: 34,
                      height: 34,
                      borderRadius: 10,
                      display: 'grid',
                      placeItems: 'center',
                      background: 'rgba(220, 38, 38, 0.12)',
                    }}
                  >
                    🗑️
                  </span>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 750, color: '#b91c1c' }}>Reset data operasional</div>
                    <div style={{ fontSize: 11.5, color: 'var(--text3)' }}>Khusus role SUPER_ADMIN</div>
                  </div>
                </div>

                <p style={{ margin: '0 0 12px', fontSize: 12.5, lineHeight: 1.6, color: 'var(--text2)' }}>
                  Menghapus seluruh data klien, proyek/lokasi, karyawan, payroll, approval, payment, invoice,
                  piutang, dan audit operasional dari database.
                </p>

                <div
                  style={{
                    padding: '10px 12px',
                    borderRadius: 10,
                    background: 'var(--bg-surface)',
                    border: '1px solid var(--border-soft)',
                    fontSize: 12,
                    lineHeight: 1.55,
                    color: 'var(--text2)',
                    marginBottom: 14,
                  }}
                >
                  <strong>Tetap dipertahankan:</strong> knowledge IDA, memory dan riwayat percakapan IDA,
                  organisasi, referensi provinsi, serta konfigurasi aplikasi.
                </div>

                <Field label={`Ketik “${RESET_CONFIRMATION}” untuk konfirmasi`}>
                  <input
                    value={resetConfirmation}
                    onChange={(event) => {
                      setResetConfirmation(event.target.value);
                      setResetStatus(null);
                    }}
                    placeholder={RESET_CONFIRMATION}
                    autoComplete="off"
                    disabled={resetting}
                    style={{
                      ...inp,
                      borderColor:
                        resetConfirmation && resetConfirmation !== RESET_CONFIRMATION
                          ? 'rgba(220, 38, 38, 0.5)'
                          : 'var(--border)',
                    }}
                  />
                </Field>

                <button
                  type="button"
                  onClick={resetOperationalData}
                  disabled={resetConfirmation !== RESET_CONFIRMATION || resetting}
                  style={{
                    width: '100%',
                    marginTop: 12,
                    border: 'none',
                    borderRadius: 10,
                    padding: '10px 14px',
                    fontSize: 12.5,
                    fontWeight: 750,
                    color: '#fff',
                    background:
                      resetConfirmation === RESET_CONFIRMATION && !resetting ? '#dc2626' : 'var(--text3)',
                    opacity: resetConfirmation === RESET_CONFIRMATION && !resetting ? 1 : 0.48,
                    cursor: resetConfirmation === RESET_CONFIRMATION && !resetting ? 'pointer' : 'not-allowed',
                  }}
                >
                  {resetting ? 'Menghapus data…' : 'Reset Semua Data Operasional'}
                </button>

                {resetStatus && (
                  <div
                    role="status"
                    style={{
                      marginTop: 12,
                      padding: '10px 12px',
                      borderRadius: 10,
                      fontSize: 12,
                      lineHeight: 1.5,
                      color: resetStatus.type === 'success' ? '#166534' : '#b91c1c',
                      background:
                        resetStatus.type === 'success' ? 'rgba(22, 163, 74, 0.08)' : 'rgba(220, 38, 38, 0.08)',
                    }}
                  >
                    {resetStatus.message}
                  </div>
                )}
              </div>
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
            {tab === 'data' ? 'Knowledge & memory IDA dilindungi' : saved ? 'Tersimpan' : 'Belum disimpan'}
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn" onClick={onClose}>
              Tutup
            </button>
            {tab !== 'data' && (
              <button type="button" className="btn btn-primary" onClick={save}>
                Simpan
              </button>
            )}
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

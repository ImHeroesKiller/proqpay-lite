'use client';

import { useEffect, useState } from 'react';
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type AppSettings } from '@/lib/app-settings';
import { saveDatabase, seedDatabase } from '@/lib/database';
import { emitDbChange } from '@/lib/events';
import { writeSystemLog } from '@/lib/system-log';
import AccountManagement from '@/components/AccountManagement';

type Tab = 'general' | 'dashboard' | 'appearance' | 'ida' | 'billing' | 'users' | 'data';
const RESET_CONFIRMATION = 'HAPUS SEMUA DATA';
const PURGE_PAYROLL_CONFIRMATION = 'HAPUS PAYMENT LEGACY DAN PAYROLL DUMMY';
const TABS: Array<{ id: Tab; label: string; icon: string; description: string }> = [
  { id: 'general', label: 'Umum', icon: '⌂', description: 'Organisasi dan perilaku awal' },
  { id: 'dashboard', label: 'Dashboard', icon: '▦', description: 'Widget, pagination, dan refresh' },
  { id: 'appearance', label: 'Tampilan', icon: '◐', description: 'Tema, warna, dan kepadatan' },
  { id: 'ida', label: 'IDA Copilot', icon: '✦', description: 'Respons dan saran operasional' },
  { id: 'billing', label: 'Billing', icon: 'Rp', description: 'Variabel invoice dan margin' },
  { id: 'users', label: 'Account Management', icon: '◎', description: 'Login, role, permission, dan client scope' },
  { id: 'data', label: 'Data & Privasi', icon: '◇', description: 'Masking dan reset operasional' },
];

export default function SettingsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('general');
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [saveState, setSaveState] = useState<'idle' | 'dirty' | 'saved'>('idle');
  const [resetConfirmation, setResetConfirmation] = useState('');
  const [resetting, setResetting] = useState(false);
  const [resetStatus, setResetStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [purgeConfirmation, setPurgeConfirmation] = useState('');
  const [purging, setPurging] = useState(false);
  const [purgeStatus, setPurgeStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    setSettings(loadSettings());
    setSaveState('idle');
    setResetConfirmation('');
    setResetStatus(null);
    setPurgeConfirmation('');
    setPurgeStatus(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open || !settings) return null;
  const activeTab = TABS.find((item) => item.id === tab) || TABS[0];

  function patch(values: Partial<AppSettings>) {
    setSettings((current) => current ? { ...current, ...values } : current);
    setSaveState('dirty');
  }

  function save() {
    if (!settings) return;
    saveSettings(settings);
    setSaveState('saved');
    writeSystemLog('SUCCESS', 'SETTINGS', 'PREFERENCES_SAVED', `Pengaturan ${activeTab.label} disimpan`);
  }

  function restorePreferences() {
    if (!settings) return;
    setSettings({ ...DEFAULT_SETTINGS, orgName: settings.orgName });
    setSaveState('dirty');
  }

  async function resetOperationalData() {
    if (resetConfirmation !== RESET_CONFIRMATION || resetting) return;
    setResetting(true);
    setResetStatus(null);
    try {
      const response = await fetch('/api/reset', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirmation: RESET_CONFIRMATION }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || data.message || `HTTP ${response.status}`);
      saveDatabase(seedDatabase());
      emitDbChange();
      setResetConfirmation('');
      setResetStatus({ type: 'success', message: `Reset selesai: ${data.deleted?.employees || 0} karyawan dan ${data.deleted?.clients || 0} klien dihapus.` });
      writeSystemLog('SUCCESS', 'SECURITY', 'SETTINGS_RESET_COMPLETED', 'Reset data operasional selesai', { deleted: data.deleted });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Reset gagal';
      setResetStatus({ type: 'error', message: `Reset gagal: ${message}. Data lokal tidak diubah.` });
      writeSystemLog('ERROR', 'SECURITY', 'SETTINGS_RESET_REJECTED', message);
    } finally {
      setResetting(false);
    }
  }

  async function purgeDummyPayroll() {
    if (purgeConfirmation !== PURGE_PAYROLL_CONFIRMATION || purging) return;
    setPurging(true);
    setPurgeStatus(null);
    try {
      const response = await fetch('/api/purge-dummy-payroll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmation: PURGE_PAYROLL_CONFIRMATION }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || data.message || `HTTP ${response.status}`);
      setPurgeConfirmation('');
      setPurgeStatus({
        type: 'success',
        message: `Pembersihan selesai: ${data.deleted?.payment_instructions || 0} PI, ${data.deleted?.payroll_submissions || 0} submission, dan ${data.deleted?.payrolls || 0} payroll dihapus.`,
      });
      emitDbChange();
      writeSystemLog('SUCCESS', 'SECURITY', 'DUMMY_PAYROLL_PURGED', 'Payment legacy dan payroll dummy dihapus', { deleted: data.deleted, proofCleanup: data.proofCleanup });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Pembersihan gagal';
      setPurgeStatus({ type: 'error', message: `Pembersihan gagal: ${message}.` });
      writeSystemLog('ERROR', 'SECURITY', 'DUMMY_PAYROLL_PURGE_REJECTED', message);
    } finally {
      setPurging(false);
    }
  }

  return (
    <div className="settings-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="settings-modal" role="dialog" aria-modal="true" aria-label="Pengaturan aplikasi">
        <header className="settings-header">
          <div><span>PREFERENSI WORKSPACE</span><h2>Pengaturan</h2><p>Sesuaikan ProQPay untuk alur kerja tim Anda.</p></div>
          <button type="button" onClick={onClose} aria-label="Tutup pengaturan">✕</button>
        </header>

        <div className="settings-layout">
          <nav className="settings-nav" aria-label="Kategori pengaturan">
            {TABS.map((item) => <button type="button" key={item.id} className={tab === item.id ? 'active' : ''} onClick={() => setTab(item.id)}><i>{item.icon}</i><span><strong>{item.label}</strong><small>{item.description}</small></span></button>)}
          </nav>

          <main className="settings-content">
            <div className="settings-section-heading"><span>{activeTab.icon}</span><div><h3>{activeTab.label}</h3><p>{activeTab.description}</p></div></div>

            {tab === 'general' ? <SettingsSection title="Identitas workspace" description="Pengaturan dasar yang terlihat oleh seluruh pengguna.">
              <div className="settings-form-grid">
                <Field label="Nama organisasi"><input value={settings.orgName} onChange={(event) => patch({ orgName: event.target.value })} /></Field>
                <Field label="Periode default"><input type="month" value={settings.defaultPeriod} onChange={(event) => patch({ defaultPeriod: event.target.value })} /></Field>
                <Field label="Halaman awal"><select value={settings.defaultView} onChange={(event) => patch({ defaultView: event.target.value as AppSettings['defaultView'] })}><option value="dashboard">Dashboard</option><option value="operations">Payroll Operations</option><option value="employees">Data Karyawan</option><option value="clients">Klien & Project</option><option value="reports">Laporan</option></select></Field>
              </div>
            </SettingsSection> : null}

            {tab === 'dashboard' ? <>
              <SettingsSection title="Komponen dashboard" description="Sembunyikan widget yang tidak dibutuhkan oleh workflow Anda.">
                <div className="settings-toggle-list">
                  <Toggle label="Kartu KPI" description="Karyawan, klien, payroll, dan piutang" checked={settings.showKpis} onChange={(value) => patch({ showKpis: value })} />
                  <Toggle label="Workforce readiness" description="Kelengkapan data dan sebaran wilayah" checked={settings.showWorkforceInsights} onChange={(value) => patch({ showWorkforceInsights: value })} />
                  <Toggle label="Peta wilayah" description="Peta interaktif distribusi karyawan" checked={settings.showMap} onChange={(value) => patch({ showMap: value })} />
                  <Toggle label="Portofolio klien" description="Daftar klien dengan jumlah karyawan dan project" checked={settings.showClientPortfolio} onChange={(value) => patch({ showClientPortfolio: value })} />
                  <Toggle label="Detail klien" description="Employee list, insight, billing, dan activity" checked={settings.showClientDetail} onChange={(value) => patch({ showClientDetail: value })} />
                  <Toggle label="Badge sumber data" description="Menampilkan status Live dari Cloudflare D1" checked={settings.showDataSourceBadges} onChange={(value) => patch({ showDataSourceBadges: value })} />
                  <Toggle label="Sparkline KPI" description="Grafik tren kecil pada kartu payroll" checked={settings.showSparklines} onChange={(value) => patch({ showSparklines: value })} />
                </div>
              </SettingsSection>
              <SettingsSection title="Pagination & sinkronisasi" description="Mengatur banyaknya data dan interval refresh.">
                <div className="settings-form-grid">
                  <Field label="Baris list dashboard"><select value={settings.dashboardPageSize} onChange={(event) => patch({ dashboardPageSize: Number(event.target.value) })}>{[3, 5, 10].map((size) => <option key={size} value={size}>{size} data / halaman</option>)}</select></Field>
                  <Field label="Baris tabel karyawan"><select value={settings.employeePageSize} onChange={(event) => patch({ employeePageSize: Number(event.target.value) })}>{[10, 15, 25, 50].map((size) => <option key={size} value={size}>{size} data / halaman</option>)}</select></Field>
                  <Field label="Refresh data otomatis"><select value={settings.autoRefreshMinutes} onChange={(event) => patch({ autoRefreshMinutes: Number(event.target.value) })}><option value={0}>Nonaktif</option><option value={1}>Setiap 1 menit</option><option value={5}>Setiap 5 menit</option><option value={15}>Setiap 15 menit</option></select></Field>
                </div>
              </SettingsSection>
            </> : null}

            {tab === 'appearance' ? <>
              <SettingsSection title="Tema & navigasi" description="Pilih kontras, warna aksen, dan bentuk sidebar.">
                <div className="settings-form-grid">
                  <Field label="Tema"><select value={settings.theme} onChange={(event) => patch({ theme: event.target.value as AppSettings['theme'] })}><option value="light">Premium light</option><option value="soft">Soft canvas</option><option value="contrast">High contrast</option></select></Field>
                  <Field label="Warna aksen"><select value={settings.accentColor} onChange={(event) => patch({ accentColor: event.target.value as AppSettings['accentColor'] })}><option value="brand">ProQPay brand</option><option value="indigo">Indigo</option><option value="blue">Blue</option><option value="teal">Teal</option></select></Field>
                  <Field label="Kepadatan"><select value={settings.density} onChange={(event) => patch({ density: event.target.value as AppSettings['density'] })}><option value="comfortable">Nyaman</option><option value="compact">Padat</option></select></Field>
                  <Field label="Sidebar"><select value={settings.sidebarMode} onChange={(event) => patch({ sidebarMode: event.target.value as AppSettings['sidebarMode'] })}><option value="expanded">Label lengkap</option><option value="compact">Ikon ringkas</option></select></Field>
                </div>
                <div className="settings-toggle-list"><Toggle label="Animasi transisi" description="Transisi halaman, widget, pagination, dan hover" checked={settings.enableAnimations} onChange={(value) => patch({ enableAnimations: value })} /></div>
              </SettingsSection>
            </> : null}

            {tab === 'ida' ? <>
              <SettingsSection title="Perilaku percakapan" description="Atur bagaimana IDA menyampaikan hasil operasional.">
                <div className="settings-toggle-list">
                  <Toggle label="Tampilkan langkah kerja" description="Ringkasan sumber dan proses yang aman ditampilkan" checked={settings.idaShowCot} onChange={(value) => patch({ idaShowCot: value })} />
                  <Toggle label="Respons ringkas" description="Prioritaskan jawaban dan angka penting" checked={settings.idaCompactResponses} onChange={(value) => patch({ idaCompactResponses: value })} />
                  <Toggle label="Saran pertanyaan lanjutan" description="Tampilkan quick action sesuai konteks" checked={settings.idaAutoSuggestions} onChange={(value) => patch({ idaAutoSuggestions: value })} />
                </div>
                <Field label={`Kecepatan animasi jawaban · ${settings.idaTypingMs} ms/karakter`}><input type="range" min={10} max={60} value={settings.idaTypingMs} onChange={(event) => patch({ idaTypingMs: Number(event.target.value) })} /></Field>
              </SettingsSection>
              <SettingsSection title="Peringatan operasional" description="Preferensi notifikasi yang akan diprioritaskan IDA.">
                <div className="settings-toggle-list">
                  <Toggle label="Kualitas data" description="NIK, BPJS, rekening, dan field wajib" checked={settings.notifyDataQuality} onChange={(value) => patch({ notifyDataQuality: value })} />
                  <Toggle label="Kontrak akan berakhir" description={`${settings.contractAlertDays} hari sebelum akhir kontrak`} checked={settings.notifyContractExpiry} onChange={(value) => patch({ notifyContractExpiry: value })} />
                  <Toggle label="Payroll perlu approval" description="Submission menunggu Controller atau Approver" checked={settings.notifyPayrollApproval} onChange={(value) => patch({ notifyPayrollApproval: value })} />
                </div>
                <Field label="Batas peringatan kontrak"><select value={settings.contractAlertDays} onChange={(event) => patch({ contractAlertDays: Number(event.target.value) })}>{[7, 14, 30, 60, 90].map((days) => <option key={days} value={days}>{days} hari</option>)}</select></Field>
              </SettingsSection>
            </> : null}

            {tab === 'billing' ? <SettingsSection title="Variabel komersial" description="Dipakai untuk invoice dan estimasi margin; bukan komponen gaji karyawan.">
              <div className="settings-form-grid">
                <Field label="Biaya jasa / karyawan"><div className="currency-input"><span>Rp</span><input type="number" min={0} value={settings.serviceFeePerEmp} onChange={(event) => patch({ serviceFeePerEmp: Number(event.target.value) || 0 })} /></div></Field>
                <Field label="Kelola BPJS / karyawan"><div className="currency-input"><span>Rp</span><input type="number" min={0} value={settings.bpjsFeePerEmp} onChange={(event) => patch({ bpjsFeePerEmp: Number(event.target.value) || 0 })} /></div></Field>
                <Field label="Biaya administrasi"><div className="currency-input"><span>Rp</span><input type="number" min={0} value={settings.adminFee} onChange={(event) => patch({ adminFee: Number(event.target.value) || 0 })} /></div></Field>
              </div>
            </SettingsSection> : null}

            {tab === 'users' ? <SettingsSection title="Account Management" description="Akun tersimpan di Cloudflare D1. Password sementara dibuat oleh server dan wajib diganti saat login pertama.">
              <AccountManagement />
            </SettingsSection> : null}

            {tab === 'data' ? <>
              <SettingsSection title="Privasi tampilan" description="Mencegah data sensitif terlihat saat layar dibagikan.">
                <div className="settings-toggle-list"><Toggle label="Masking data sensitif" description="Samarkan NIK, NPWP, rekening, dan nomor BPJS pada detail karyawan" checked={settings.maskSensitiveData} onChange={(value) => patch({ maskSensitiveData: value })} /></div>
              </SettingsSection>
              <section className="settings-danger-zone"><span>DANGER ZONE</span><h4>Hapus payment legacy & payroll dummy</h4><p>Menghapus PI, bank file metadata, approval, proof, reconciliation, invoice, submission, exception, dan payroll. Master karyawan, rekening, klien, project, user, dan konfigurasi dipertahankan.</p><Field label={`Ketik “${PURGE_PAYROLL_CONFIRMATION}”`}><input value={purgeConfirmation} onChange={(event) => { setPurgeConfirmation(event.target.value); setPurgeStatus(null); }} placeholder={PURGE_PAYROLL_CONFIRMATION} disabled={purging} /></Field><button type="button" disabled={purgeConfirmation !== PURGE_PAYROLL_CONFIRMATION || purging} onClick={() => void purgeDummyPayroll()}>{purging ? 'Membersihkan…' : 'Hapus payment & payroll dummy'}</button>{purgeStatus ? <div className={`settings-status ${purgeStatus.type}`} role="status">{purgeStatus.message}</div> : null}</section>
              <section className="settings-danger-zone"><span>DANGER ZONE</span><h4>Reset data operasional</h4><p>Menghapus klien, project, karyawan, payroll, pembayaran, invoice, dan audit operasional. Knowledge dan memory IDA dipertahankan.</p><Field label={`Ketik “${RESET_CONFIRMATION}”`}><input value={resetConfirmation} onChange={(event) => { setResetConfirmation(event.target.value); setResetStatus(null); }} placeholder={RESET_CONFIRMATION} disabled={resetting} /></Field><button type="button" disabled={resetConfirmation !== RESET_CONFIRMATION || resetting} onClick={() => void resetOperationalData()}>{resetting ? 'Menghapus…' : 'Reset semua data operasional'}</button>{resetStatus ? <div className={`settings-status ${resetStatus.type}`} role="status">{resetStatus.message}</div> : null}</section>
            </> : null}
          </main>
        </div>

        <footer className="settings-footer"><button type="button" className="settings-reset-preferences" onClick={restorePreferences}>Pulihkan preferensi</button><span className={saveState === 'saved' ? 'saved' : ''}>{saveState === 'saved' ? '✓ Perubahan tersimpan' : saveState === 'dirty' ? 'Ada perubahan yang belum disimpan' : 'Tidak ada perubahan'}</span><div><button type="button" className="btn" onClick={onClose}>Batal</button><button type="button" className="btn btn-primary" disabled={saveState !== 'dirty'} onClick={save}>Simpan perubahan</button></div></footer>
      </div>
    </div>
  );
}

function SettingsSection({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return <section className="settings-section"><div><h4>{title}</h4><p>{description}</p></div>{children}</section>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="settings-field"><span>{label}</span>{children}</label>;
}

function Toggle({ label, description, checked, onChange }: { label: string; description: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <label className="settings-toggle"><span><strong>{label}</strong><small>{description}</small></span><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><i aria-hidden="true" /></label>;
}

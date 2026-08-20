'use client';

import { FormEvent, useState } from 'react';

async function postAccount(payload: Record<string, unknown>) {
  const response = await fetch('/api/accounts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

export function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const response = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Login gagal');
      window.location.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Login gagal');
    } finally { setBusy(false); }
  }

  return <main className="login-page">
    <section className="login-panel">
      <div className="login-brand">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/assets/proqpay-logo.jpg" alt="ProQPay Lite" />
        <small>Secure Payroll Operations</small>
      </div>
      <div className="login-heading"><span>ACCOUNT LOGIN</span><h1>Masuk ke workspace</h1><p>Gunakan akun yang dibuat oleh Super Admin.</p></div>
      <form onSubmit={submit} className="login-form">
        <label><span>Email</span><input type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
        <label><span>Password</span><input type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
        {error ? <div className="login-error" role="alert">{error}</div> : null}
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Memverifikasi…' : 'Masuk'}</button>
      </form>
      <p className="login-security">Sesi terenkripsi · Akses berbasis role · Aktivitas tercatat</p>
    </section>
  </main>;
}

export function ChangePasswordModal({ forced, onClose }: { forced: boolean; onClose?: () => void }) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent) {
    event.preventDefault(); setError('');
    if (newPassword !== confirm) { setError('Konfirmasi password tidak sama'); return; }
    setBusy(true);
    try {
      await postAccount({ action: 'CHANGE_PASSWORD', currentPassword, newPassword });
      await fetch('/api/logout', { method: 'POST' });
      window.location.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Password gagal diubah');
    } finally { setBusy(false); }
  }

  return <div className="auth-modal-backdrop" onMouseDown={(event) => { if (!forced && event.target === event.currentTarget) onClose?.(); }}>
    <section className="auth-modal" role="dialog" aria-modal="true" aria-label="Ganti password">
      <span className="page-eyebrow">KEAMANAN AKUN</span><h2>{forced ? 'Ganti password sementara' : 'Ganti password'}</h2>
      <p>{forced ? 'Password sementara wajib diganti sebelum melanjutkan penggunaan ProQPay.' : 'Gunakan minimal 12 karakter dengan kombinasi lengkap.'}</p>
      <form onSubmit={submit} className="login-form">
        <label><span>Password saat ini</span><input type="password" autoComplete="current-password" required value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></label>
        <label><span>Password baru</span><input type="password" autoComplete="new-password" required minLength={12} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></label>
        <label><span>Ulangi password baru</span><input type="password" autoComplete="new-password" required minLength={12} value={confirm} onChange={(event) => setConfirm(event.target.value)} /></label>
        {error ? <div className="login-error" role="alert">{error}</div> : null}
        <div className="auth-modal-actions">{!forced ? <button type="button" className="btn" onClick={onClose}>Batal</button> : null}<button className="btn btn-primary" disabled={busy}>{busy ? 'Menyimpan…' : 'Simpan password'}</button></div>
      </form>
    </section>
  </div>;
}

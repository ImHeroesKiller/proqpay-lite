"use client";

import { FormEvent, useState } from "react";
import Image from "next/image";

async function postAccount(payload: Record<string, unknown>) {
  const response = await fetch("/api/accounts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

export function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Login gagal");
      window.location.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Login gagal");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-shell" aria-label="ProQPay secure login">
        <div className="login-story">
          <Image
            className="login-story-image"
            src="/assets/login-payroll-team.webp"
            alt="Tim payroll dan finance berkolaborasi di kantor modern"
            fill
            priority
            sizes="(max-width: 820px) 0px, 60vw"
          />
          <div className="login-story-overlay" />
          <div className="login-story-content">
            <div className="login-brand login-brand-inverse">
              <Image
                src="/assets/proqpay-logo.png"
                alt="ProQPay"
                width={210}
                height={49}
                priority
              />
              <small>Secure Payroll Operations</small>
            </div>
            <div className="login-story-copy">
              <span>AI PAYROLL OPERATING SYSTEM</span>
              <h1>
                Payroll Operations,
                <br />
                Simplified.
              </h1>
              <p>
                Kelola kesiapan data, payroll processing, payment instruction,
                approval, dan rekonsiliasi dalam satu controlled workflow.
              </p>
            </div>
            <ul className="login-benefits">
              <li>
                <i>✓</i>AI-assisted Data Readiness
              </li>
              <li>
                <i>✓</i>Controlled Maker–Checker Workflow
              </li>
              <li>
                <i>✓</i>Secure Payroll &amp; Payment Operations
              </li>
            </ul>
            <p className="login-trust">
              Cloudflare Native <b>·</b> Secure D1 &amp; R2 <b>·</b> Auditable
              Workflow
            </p>
          </div>
        </div>
        <div className="login-panel">
          <div className="login-mobile-brand login-brand">
            <Image
              src="/assets/proqpay-logo.png"
              alt="ProQPay"
              width={210}
              height={49}
              priority
            />
            <small>Secure Payroll Operations</small>
          </div>
          <div className="login-heading">
            <span>SECURE ACCOUNT LOGIN</span>
            <h2>Selamat datang kembali</h2>
            <p>
              Masuk menggunakan akun ProQPay yang diberikan oleh administrator
              perusahaan Anda.
            </p>
          </div>
          <form onSubmit={submit} className="login-form">
            <label>
              <span>Email perusahaan</span>
              <input
                type="email"
                autoComplete="username"
                inputMode="email"
                required
                placeholder="nama@perusahaan.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
            <label>
              <span>Password</span>
              <div className="login-password-field">
                <input
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  required
                  placeholder="Masukkan password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
                <button
                  type="button"
                  aria-label={
                    showPassword ? "Sembunyikan password" : "Tampilkan password"
                  }
                  aria-pressed={showPassword}
                  onClick={() => setShowPassword((visible) => !visible)}
                >
                  {showPassword ? "Sembunyikan" : "Tampilkan"}
                </button>
              </div>
            </label>
            {error ? (
              <div className="login-error" role="alert">
                <strong>Login belum berhasil</strong>
                <span>{error}</span>
              </div>
            ) : null}
            <button
              className="btn btn-primary login-submit"
              disabled={busy}
              aria-busy={busy}
            >
              {busy ? (
                <>
                  <i className="login-spinner" />
                  Memverifikasi…
                </>
              ) : (
                "Masuk ke ProQPay"
              )}
            </button>
          </form>
          <p className="login-security">
            <span>◉</span>Sesi terenkripsi · Akses berbasis role · Aktivitas
            tercatat
          </p>
        </div>
      </section>
    </main>
  );
}

export function ChangePasswordModal({
  forced,
  onClose,
}: {
  forced: boolean;
  onClose?: () => void;
}) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (newPassword !== confirm) {
      setError("Konfirmasi password tidak sama");
      return;
    }
    setBusy(true);
    try {
      await postAccount({
        action: "CHANGE_PASSWORD",
        currentPassword,
        newPassword,
      });
      await fetch("/api/logout", { method: "POST" });
      window.location.reload();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Password gagal diubah",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="auth-modal-backdrop"
      onMouseDown={(event) => {
        if (!forced && event.target === event.currentTarget) onClose?.();
      }}
    >
      <section
        className="auth-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Ganti password"
      >
        <span className="page-eyebrow">KEAMANAN AKUN</span>
        <h2>{forced ? "Ganti password sementara" : "Ganti password"}</h2>
        <p>
          {forced
            ? "Password sementara wajib diganti sebelum melanjutkan penggunaan ProQPay."
            : "Gunakan minimal 12 karakter dengan kombinasi lengkap."}
        </p>
        <form onSubmit={submit} className="login-form">
          <label>
            <span>Password saat ini</span>
            <input
              type="password"
              autoComplete="current-password"
              required
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
            />
          </label>
          <label>
            <span>Password baru</span>
            <input
              type="password"
              autoComplete="new-password"
              required
              minLength={12}
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
            />
          </label>
          <label>
            <span>Ulangi password baru</span>
            <input
              type="password"
              autoComplete="new-password"
              required
              minLength={12}
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
            />
          </label>
          {error ? (
            <div className="login-error" role="alert">
              {error}
            </div>
          ) : null}
          <div className="auth-modal-actions">
            {!forced ? (
              <button type="button" className="btn" onClick={onClose}>
                Batal
              </button>
            ) : null}
            <button className="btn btn-primary" disabled={busy}>
              {busy ? "Menyimpan…" : "Simpan password"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

"use client";

import { FormEvent, useMemo, useState } from "react";
import Image from "next/image";
import { createPasskey, getPasskey } from "@/lib/webauthn-browser";
import { createTotpQrDataUrl } from "@/lib/totp-qr";

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
  const [mfaStage, setMfaStage] = useState<'NONE'|'CODE'|'ENROLL'>('NONE');
  const [mfaCode, setMfaCode] = useState('');
  const [mfaSecret, setMfaSecret] = useState('');
  const [mfaUri, setMfaUri] = useState('');
  const [passkeyRecoveryAvailable, setPasskeyRecoveryAvailable] = useState(false);
  const [mfaSecretCopied, setMfaSecretCopied] = useState(false);
  const [passkeyRecovery, setPasskeyRecovery] = useState(false);
  const mfaQrDataUrl = useMemo(() => createTotpQrDataUrl(mfaUri), [mfaUri]);

  async function requestLogin(extra: Record<string, unknown> = {}) {
    const response = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, ...extra }),
    });
    const data = await response.json().catch(() => ({}));
    return { response, data };
  }

  async function enrollRequiredPasskey() {
    const optionsResponse = await fetch("/api/security-passkey", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "REGISTER_OPTIONS" }),
    });
    const optionsData = await optionsResponse.json().catch(() => ({}));
    if (!optionsResponse.ok) {
      throw new Error(optionsData.error || "Opsi passkey gagal dibuat");
    }

    const credential = await createPasskey(optionsData.options || {});
    const verifyResponse = await fetch("/api/security-passkey", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "REGISTER_VERIFY",
        challengeId: optionsData.challengeId,
        response: credential,
        label: "Primary Passkey",
      }),
    });
    const verifyData = await verifyResponse.json().catch(() => ({}));
    if (!verifyResponse.ok) {
      await fetch("/api/logout", { method: "POST" }).catch(() => undefined);
      throw new Error(verifyData.error || "Registrasi passkey gagal");
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (passkeyRecovery) {
        const recovery = await fetch("/api/security-passkey-recovery", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password, mfaCode }),
        });
        const recovered = await recovery.json().catch(() => ({}));
        if (!recovery.ok) throw new Error(recovered.error || "Recovery passkey gagal");
        setPasskeyRecovery(false);
        setPasskeyRecoveryAvailable(false);
        setMfaStage("NONE");
        setMfaCode("");
        setError("Recovery selesai. Passkey lama dicabut; login kembali untuk mendaftarkan passkey baru.");
        return;
      }

      if (mfaStage === "ENROLL") {
        const activate = await fetch("/api/security-mfa", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "ENROLL_ACTIVATE", email, password, code: mfaCode }),
        });
        const activated = await activate.json().catch(() => ({}));
        if (!activate.ok) throw new Error(activated.error || "Aktivasi MFA gagal");
      }

      let login = await requestLogin({ mfaCode: mfaCode || undefined });

      if (login.response.status === 428 && login.data.code === "MFA_REQUIRED") {
        setMfaStage("CODE");
        setError("Masukkan kode MFA 6 digit dari Google Authenticator.");
        return;
      }

      if (login.response.status === 428 && login.data.code === "MFA_ENROLLMENT_REQUIRED") {
        const enrollment = await fetch("/api/security-mfa", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "ENROLL_START", email, password }),
        });
        const enrolled = await enrollment.json().catch(() => ({}));
        if (!enrollment.ok) throw new Error(enrolled.error || "Enrollment MFA gagal");
        if (enrolled.code === "MFA_ALREADY_ACTIVE" || enrolled.alreadyActive) {
          setMfaStage("CODE");
          setMfaCode("");
          setMfaSecret("");
          setMfaUri("");
          setError("MFA sudah terdaftar. Masukkan kode 6 digit dari Google Authenticator.");
          return;
        }
        setMfaSecret(String(enrolled.secret || ""));
        setMfaUri(String(enrolled.otpauthUri || ""));
        setMfaCode("");
        setMfaStage("ENROLL");
        setError("MFA wajib diaktifkan untuk role ini. Tambahkan akun ProQPay ke Google Authenticator lalu masukkan kode 6 digit.");
        return;
      }

      if (login.response.status === 428 && login.data.code === "PASSKEY_REQUIRED") {
        try {
          const assertion = await getPasskey(login.data.options || {});
          login = await requestLogin({
            passkeyChallengeId: login.data.challengeId,
            passkeyResponse: assertion,
          });
        } catch (cause) {
          setPasskeyRecoveryAvailable(true);
          throw cause;
        }
      }

      if (!login.response.ok) throw new Error(login.data.error || "Login gagal");

      if (login.data.security?.passkeyEnrollmentRequired) {
        setError("Mendaftarkan passkey wajib untuk akses privileged…");
        await enrollRequiredPasskey();
      }

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
                src="/assets/proqpay-logo-v2.svg"
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
              src="/assets/proqpay-logo-v2.svg"
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
            {mfaStage !== 'NONE' ? (
              <label>
                <span>Kode MFA</span>
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{6}"
                  minLength={6}
                  maxLength={6}
                  required
                  placeholder="6 digit"
                  value={mfaCode}
                  onChange={(event) => setMfaCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                />
              </label>
            ) : null}
            {mfaStage === 'ENROLL' && mfaSecret ? (
              <div className="login-error mfa-enrollment-card" role="note">
                <strong>Aktifkan Google Authenticator</strong>
                <span>Scan QR Code ini dari Google Authenticator → Tambahkan kode → Scan QR code.</span>
                {mfaQrDataUrl ? (
                  <div className="mfa-qr-wrap">
                    <Image
                      className="mfa-qr-image"
                      src={mfaQrDataUrl}
                      width={220}
                      height={220}
                      alt="QR Code setup Google Authenticator untuk ProQPay"
                      unoptimized
                    />
                  </div>
                ) : null}
                <span>Jika scan tidak tersedia, gunakan setup key manual:</span>
                <span className="mfa-setup-key"><code>{mfaSecret}</code></span>
                <div className="auth-modal-actions">
                  <button
                    type="button"
                    className="btn"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(mfaSecret);
                        setMfaSecretCopied(true);
                        window.setTimeout(() => setMfaSecretCopied(false), 1800);
                      } catch {
                        setMfaSecretCopied(false);
                      }
                    }}
                  >
                    {mfaSecretCopied ? "Setup key tersalin" : "Salin setup key"}
                  </button>
                  {mfaUri ? (
                    <a className="btn" href={mfaUri}>
                      Buka di Authenticator
                    </a>
                  ) : null}
                </div>
                <small>QR dibuat lokal di browser. Secret MFA tidak dikirim ke layanan QR eksternal. TOTP: 6 digit · 30 detik.</small>
              </div>
            ) : null}
            {error ? (
              <div className="login-error" role="alert">
                <strong>{passkeyRecovery ? "Recovery passkey" : "Login belum berhasil"}</strong>
                <span>{error}</span>
              </div>
            ) : null}
            {passkeyRecoveryAvailable ? (
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setPasskeyRecovery(true);
                  setPasskeyRecoveryAvailable(false);
                  setMfaStage("CODE");
                  setMfaCode("");
                  setError("Masukkan kode TOTP untuk recovery. Semua passkey aktif akan dicabut dan wajib didaftarkan ulang.");
                }}
              >
                Recovery dengan TOTP
              </button>
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
              ) : passkeyRecovery ? (
                "Pulihkan & Cabut Passkey"
              ) : mfaStage === 'ENROLL' ? (
                "Aktifkan MFA & Masuk"
              ) : mfaStage === 'CODE' ? (
                "Verifikasi MFA & Masuk"
              ) : (
                "Masuk ke ProQPay"
              )}
            </button>
          </form>
          <p className="login-security">
            <span>◉</span>Sesi terenkripsi · Google Authenticator TOTP · Passkey/WebAuthn privileged · Aktivitas
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

'use client';

import { useCallback, useEffect, useState } from 'react';

type CredentialSummary = {
  stored: Record<string, boolean>;
  masked: Record<string, string | null>;
};

type GatewaySettings = {
  provider: 'UNCONFIGURED' | 'E2PAY';
  environment: 'UAT' | 'PRODUCTION';
  stored: Record<string, boolean>;
  masked: Record<string, string | null>;
  profiles?: Record<'UAT' | 'PRODUCTION', CredentialSummary>;
  updatedBy?: string | null;
  updatedAt?: string | null;
};

type FormState = {
  provider: 'UNCONFIGURED' | 'E2PAY';
  environment: 'UAT' | 'PRODUCTION';
  clientId: string;
  clientSecret: string;
  username: string;
  passwordMd5: string;
  accountSrc: string;
  sourceId: string;
};

const EMPTY: FormState = {
  provider:'E2PAY',
  environment:'UAT',
  clientId:'',
  clientSecret:'',
  username:'',
  passwordMd5:'',
  accountSrc:'',
  sourceId:'',
};

function profileSummary(settings: GatewaySettings | null, environment: FormState['environment']) {
  return settings?.profiles?.[environment] || {
    stored: settings?.environment === environment ? settings.stored : {},
    masked: settings?.environment === environment ? settings.masked : {},
  };
}

function fieldHint(settings: GatewaySettings | null, environment: FormState['environment'], key: string) {
  const masked = profileSummary(settings, environment).masked?.[key];
  return masked ? 'Tersimpan · ' + masked : 'Belum diisi';
}

export default function PaymentGatewaySettings() {
  const [server, setServer] = useState<GatewaySettings | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState<{ type:'success' | 'error' | 'info'; text:string } | null>(null);
  const [connection, setConnection] = useState<{ accountName:string; merchantStatus:string; balance:number; bankCount:number } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/payment-gateway-settings', {
        headers:{ Accept:'application/json' },
        cache:'no-store',
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || data.message || 'Gagal memuat credential gateway');
      const settings = data.settings as GatewaySettings;
      setServer(settings);
      setForm((current) => ({
        ...current,
        provider:settings.provider || 'UNCONFIGURED',
        environment:settings.environment || 'UAT',
      }));
    } catch (error) {
      setMessage({ type:'error', text:error instanceof Error ? error.message : 'Gagal memuat credential gateway' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  function patch(values: Partial<FormState>) {
    setForm((current) => ({ ...current, ...values }));
    setMessage(null);
    setConnection(null);
  }

  async function save() {
    setBusy('save');
    setMessage(null);
    try {
      const response = await fetch('/api/payment-gateway-settings', {
        method:'POST',
        headers:{ 'Content-Type':'application/json' },
        body:JSON.stringify({ action:'SAVE', ...form }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || data.message || 'Credential gagal disimpan');
      setServer(data.settings);
      setForm({
        provider:data.settings.provider,
        environment:data.settings.environment,
        clientId:'',
        clientSecret:'',
        username:'',
        passwordMd5:'',
        accountSrc:'',
        sourceId:'',
      });
      setMessage({
        type:'success',
        text:data.readiness?.configured
          ? 'Credential tersimpan terenkripsi. E2Pay siap untuk ' + data.settings.environment + '.'
          : 'Credential tersimpan. Lengkapi field yang belum tersedia sebelum digunakan.',
      });
    } catch (error) {
      setMessage({ type:'error', text:error instanceof Error ? error.message : 'Credential gagal disimpan' });
    } finally {
      setBusy('');
    }
  }

  async function testConnection() {
    setBusy('test');
    setMessage(null);
    setConnection(null);
    try {
      const response = await fetch('/api/payment-gateway-settings', {
        method:'POST',
        headers:{ 'Content-Type':'application/json' },
        body:JSON.stringify({ action:'TEST', ...form }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || data.message || 'Test E2Pay gagal');
      setConnection(data.connection);
      setMessage({ type:'success', text:'Koneksi E2Pay ' + (data.readiness?.environment || '') + ' berhasil.' });
    } catch (error) {
      setMessage({ type:'error', text:error instanceof Error ? error.message : 'Test E2Pay gagal' });
    } finally {
      setBusy('');
    }
  }

  const credentialFields: Array<{ key:keyof FormState; label:string; secret?:boolean; placeholder:string }> = [
    { key:'clientId', label:'E2PAY_CLIENT_ID', placeholder:'Masukkan Client ID baru' },
    { key:'clientSecret', label:'E2PAY_CLIENT_SECRET', secret:true, placeholder:'Masukkan Client Secret baru' },
    { key:'username', label:'E2PAY_USERNAME', placeholder:'Masukkan username merchant' },
    { key:'passwordMd5', label:'E2PAY_PASSWORD_MD5', secret:true, placeholder:'32 karakter MD5 uppercase' },
    { key:'accountSrc', label:'E2PAY_ACCOUNT_SRC', placeholder:'Masukkan source account' },
    { key:'sourceId', label:'E2PAY_SOURCE_ID', placeholder:'Masukkan Source ID' },
  ];

  return <div style={{ display:'grid', gap:16 }}>
    <div className="settings-form-grid">
      <label className="settings-field">
        <span>PAYMENT_GATEWAY_PROVIDER</span>
        <select value={form.provider} disabled={loading || Boolean(busy)} onChange={(event) => patch({ provider:event.target.value as FormState['provider'] })}>
          <option value="E2PAY">E2PAY</option>
          <option value="UNCONFIGURED">Nonaktif / UNCONFIGURED</option>
        </select>
      </label>
      <label className="settings-field">
        <span>E2PAY_ENV</span>
        <select value={form.environment} disabled={loading || Boolean(busy)} onChange={(event) => patch({ environment:event.target.value as FormState['environment'] })}>
          <option value="UAT">UAT</option>
          <option value="PRODUCTION">PRODUCTION</option>
        </select>
      </label>
    </div>

    {form.environment === 'PRODUCTION' ? <div className="app-notice-bubble app-notice-error" role="alert">
      <strong>Production environment</strong>
      <span>Credential Production disimpan terpisah dari UAT. Pastikan UAT dan rekonsiliasi beneficiary sudah selesai sebelum mengaktifkan Production.</span>
    </div> : null}

    <div className="settings-form-grid">
      {credentialFields.map((item) => <label className="settings-field" key={item.key}>
        <span>{item.label}</span>
        <input
          type={item.secret ? 'password' : 'text'}
          autoComplete="off"
          value={String(form[item.key] || '')}
          disabled={loading || Boolean(busy)}
          placeholder={item.placeholder}
          onChange={(event) => patch({ [item.key]:event.target.value } as Partial<FormState>)}
        />
        <small style={{ color:'var(--text3)', fontSize:10.5 }}>
          {fieldHint(server, form.environment, item.key)}
          {profileSummary(server, form.environment).stored?.[item.key] ? ' · kosongkan input jika tidak ingin mengganti' : ''}
        </small>
      </label>)}
    </div>

    <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
      <button type="button" className="btn btn-primary" disabled={loading || Boolean(busy)} onClick={() => void save()}>
        {busy === 'save' ? 'Menyimpan…' : 'Simpan Credential'}
      </button>
      <button type="button" className="btn" disabled={loading || Boolean(busy) || form.provider !== 'E2PAY'} onClick={() => void testConnection()}>
        {busy === 'test' ? 'Menguji…' : 'Test Connection'}
      </button>
      <button type="button" className="btn" disabled={loading || Boolean(busy)} onClick={() => void load()}>
        Refresh
      </button>
    </div>

    {message ? <div className={'settings-status ' + message.type} role="status">{message.text}</div> : null}

    {connection ? <div className="card" style={{ padding:14, display:'grid', gap:6 }}>
      <strong style={{ fontSize:12 }}>E2Pay Connection</strong>
      <span style={{ fontSize:11.5, color:'var(--text3)' }}>Merchant: {connection.accountName || '-'}</span>
      <span style={{ fontSize:11.5, color:'var(--text3)' }}>Status: {connection.merchantStatus || '-'}</span>
      <span style={{ fontSize:11.5, color:'var(--text3)' }}>Balance: Rp {Number(connection.balance || 0).toLocaleString('id-ID')}</span>
      <span style={{ fontSize:11.5, color:'var(--text3)' }}>Bank directory: {connection.bankCount} bank</span>
    </div> : null}

    <div style={{ borderTop:'1px solid var(--border-soft)', paddingTop:12, color:'var(--text3)', fontSize:11.5, lineHeight:1.6 }}>
      Credential disimpan terenkripsi di server. Nilai credential yang sudah tersimpan tidak dikirim kembali ke browser. Perubahan tercatat di Audit Logs tanpa menyimpan nilai secret.
      {server?.updatedAt ? <div>Last update: {new Date(server.updatedAt).toLocaleString('id-ID')} · {server.updatedBy || '-'}</div> : null}
    </div>
  </div>;
}

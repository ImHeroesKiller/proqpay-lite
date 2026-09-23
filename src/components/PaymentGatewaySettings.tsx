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
  merchantName: string;
  clientId: string;
  clientSecret: string;
  partnerId: string;
  sourceId: string;
  username: string;
  password: string;
  merchantId: string;
};

const EMPTY: FormState = {
  provider:'E2PAY',
  environment:'UAT',
  merchantName:'PT Mandiri Semesta Gemilang',
  clientId:'',
  clientSecret:'',
  partnerId:'0041',
  sourceId:'MANDIRIS',
  username:'6281510000006',
  password:'',
  merchantId:'00410187',
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
  const [connection, setConnection] = useState<{ hostAuthorized:boolean; merchantLoginAuthorized:boolean; tokenType:string; expiresIn:number|null; merchantName:string; merchantStatus:string; merchantId:string; partnerId:string; sourceId:string; accountSrcMasked:string; bankCount:number; nextStep:string } | null>(null);

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
        merchantName:'',
        clientId:'',
        clientSecret:'',
        partnerId:'',
        sourceId:'',
        username:'',
        password:'',
        merchantId:'',
      });
      setMessage({
        type:'success',
        text:data.hostReadiness?.configured
          ? 'Credential host UAT tersimpan terenkripsi. Gunakan Test Connection untuk validasi clientId/clientSecret.'
          : 'Credential tersimpan. Lengkapi credential host yang belum tersedia.',
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
      setMessage({ type:'success', text:'Client Host Authorization E2Pay ' + (data.readiness?.environment || '') + ' berhasil.' });
    } catch (error) {
      setMessage({ type:'error', text:error instanceof Error ? error.message : 'Test E2Pay gagal' });
    } finally {
      setBusy('');
    }
  }

  const credentialFields: Array<{ key:keyof FormState; label:string; secret?:boolean; placeholder:string }> = [
    { key:'merchantName', label:'Name', placeholder:'PT Mandiri Semesta Gemilang' },
    { key:'clientId', label:'clientId', placeholder:'Masukkan Client ID UAT' },
    { key:'clientSecret', label:'clientSecret', secret:true, placeholder:'Masukkan Client Secret UAT' },
    { key:'partnerId', label:'partnerId', placeholder:'0041' },
    { key:'sourceId', label:'sourceId', placeholder:'MANDIRIS' },
    { key:'username', label:'username', placeholder:'6281510000006' },
    { key:'password', label:'password', secret:true, placeholder:'Masukkan password merchant UAT' },
    { key:'merchantId', label:'merchantId', placeholder:'00410187' },
  ];

  return <div style={{ display:'grid', gap:16 }}>
    <div className="app-notice-bubble" role="note">
      <strong>Credential UAT yang diberikan E2Pay</strong>
      <span>Bootstrap credential tetap Name, clientId, clientSecret, partnerId, dan sourceId. Karena username/password/merchantId sudah tersedia, ProQPay juga dapat memvalidasi merchant login dan menemukan accountId/source account otomatis. Access token dan refresh token tetap tidak perlu diinput manual.</span>
    </div>

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
      <strong style={{ fontSize:12 }}>E2Pay UAT Connection</strong>
      <span style={{ fontSize:11.5, color:'var(--text3)' }}>Host authorization: {connection.hostAuthorized ? 'SUCCESS' : 'FAILED'}</span>
      <span style={{ fontSize:11.5, color:'var(--text3)' }}>Merchant login: {connection.merchantLoginAuthorized ? 'SUCCESS' : 'NOT TESTED'}</span>
      <span style={{ fontSize:11.5, color:'var(--text3)' }}>Merchant: {connection.merchantName || '-'} {connection.merchantStatus ? '· ' + connection.merchantStatus : ''}</span>
      <span style={{ fontSize:11.5, color:'var(--text3)' }}>Merchant ID: {connection.merchantId || '-'}</span>
      <span style={{ fontSize:11.5, color:'var(--text3)' }}>Partner ID: {connection.partnerId || '-'}</span>
      <span style={{ fontSize:11.5, color:'var(--text3)' }}>Source ID: {connection.sourceId || '-'}</span>
      <span style={{ fontSize:11.5, color:'var(--text3)' }}>Source account: {connection.accountSrcMasked || 'belum ditemukan'}</span>
      <span style={{ fontSize:11.5, color:'var(--text3)' }}>Bank directory: {connection.bankCount || 0} bank</span>
      <span style={{ fontSize:11.5, color:'var(--text3)' }}>Token type: {connection.tokenType || 'Bearer'}{connection.expiresIn ? ' · expires ' + connection.expiresIn + 's' : ''}</span>
      <span style={{ fontSize:11.5, color:'var(--text3)' }}>{connection.nextStep}</span>
    </div> : null}

    <div style={{ borderTop:'1px solid var(--border-soft)', paddingTop:12, color:'var(--text3)', fontSize:11.5, lineHeight:1.6 }}>
      Credential disimpan terenkripsi di server. Password merchant dinormalisasi menjadi MD5 uppercase di backend sesuai kontrak E2Pay dan tidak dikirim kembali ke browser. Test Connection memvalidasi host authorization, username, merchant login, lalu menemukan source account otomatis.
      {server?.updatedAt ? <div>Last update: {new Date(server.updatedAt).toLocaleString('id-ID')} · {server.updatedBy || '-'}</div> : null}
    </div>
  </div>;
}

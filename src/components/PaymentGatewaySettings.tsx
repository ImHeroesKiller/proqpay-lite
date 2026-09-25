'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

type CredentialSummary = {
  stored: Record<string, boolean>;
  masked: Record<string, string | null>;
};

type GatewaySettings = {
  provider: 'UNCONFIGURED' | 'E2PAY';
  environment: 'UAT' | 'PRODUCTION';
  activeProvider?: 'UNCONFIGURED' | 'E2PAY';
  activeEnvironment?: 'UAT' | 'PRODUCTION';
  draftProvider?: 'UNCONFIGURED' | 'E2PAY';
  draftEnvironment?: 'UAT' | 'PRODUCTION';
  stored: Record<string, boolean>;
  masked: Record<string, string | null>;
  profiles?: Record<'UAT' | 'PRODUCTION', CredentialSummary>;
  activatedBy?: string | null;
  activatedAt?: string | null;
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
  username:'',
  password:'',
  merchantId:'',
};

function profileSummary(settings: GatewaySettings | null, environment: FormState['environment']) {
  return settings?.profiles?.[environment] || {
    stored: settings?.draftEnvironment === environment || settings?.environment === environment ? settings.stored : {},
    masked: settings?.draftEnvironment === environment || settings?.environment === environment ? settings.masked : {},
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
  const [draftSaved, setDraftSaved] = useState(false);
  const [executionReady, setExecutionReady] = useState(false);
  const [activationAcknowledged, setActivationAcknowledged] = useState(false);
  const [message, setMessage] = useState<{ type:'success' | 'error' | 'info'; text:string } | null>(null);
  const [connection, setConnection] = useState<{ hostAuthorized:boolean; merchantLoginAuthorized:boolean; tokenType:string; expiresIn:number|null; merchantName:string; merchantStatus:string; merchantId:string; partnerId:string; sourceId:string; accountSrcMasked:string; bankCount:number; nextStep:string } | null>(null);

  const activeProvider = server?.activeProvider || server?.provider || 'UNCONFIGURED';
  const activeEnvironment = server?.activeEnvironment || server?.environment || 'UAT';
  const isDraftDifferent = useMemo(
    () => form.provider !== activeProvider || form.environment !== activeEnvironment,
    [form.provider, form.environment, activeProvider, activeEnvironment],
  );

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
        provider:settings.draftProvider || settings.provider || 'UNCONFIGURED',
        environment:settings.draftEnvironment || settings.environment || 'UAT',
      }));
      setDraftSaved(false);
      setExecutionReady(false);
      setActivationAcknowledged(false);
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
    setExecutionReady(false);
    setDraftSaved(false);
    setActivationAcknowledged(false);
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
      setForm((current) => ({
        ...current,
        merchantName:'',
        clientId:'',
        clientSecret:'',
        partnerId:'',
        sourceId:'',
        username:'',
        password:'',
        merchantId:'',
      }));
      setDraftSaved(true);
      setExecutionReady(false);
      setActivationAcknowledged(false);
      setMessage({
        type:'success',
        text:'Draft credential tersimpan terenkripsi. Runtime payment belum berubah. Jalankan Test Connection sebelum aktivasi.',
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
      const ready = Boolean(data.executionReadiness?.configured);
      setExecutionReady(ready);
      setMessage({
        type:ready ? 'success' : 'info',
        text:ready
          ? 'Test berhasil. Profile execution-ready dan belum mengubah runtime.'
          : 'Host authorization berhasil, tetapi profile belum execution-ready.',
      });
    } catch (error) {
      setExecutionReady(false);
      setMessage({ type:'error', text:error instanceof Error ? error.message : 'Test E2Pay gagal' });
    } finally {
      setBusy('');
    }
  }

  async function activate() {
    setBusy('activate');
    setMessage(null);
    try {
      const confirmation = form.provider === 'UNCONFIGURED'
        ? 'DISABLE_GATEWAY'
        : form.environment === 'PRODUCTION' ? 'ACTIVATE_PRODUCTION' : 'ACTIVATE_UAT';
      const response = await fetch('/api/payment-gateway-settings', {
        method:'POST',
        headers:{ 'Content-Type':'application/json' },
        body:JSON.stringify({ action:'ACTIVATE', confirmation, ...form }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || data.message || 'Aktivasi gateway gagal');
      setServer(data.settings);
      setDraftSaved(false);
      setExecutionReady(false);
      setActivationAcknowledged(false);
      setConnection(null);
      setMessage({
        type:'success',
        text:form.provider === 'UNCONFIGURED'
          ? 'Payment Gateway dinonaktifkan.'
          : `Profile ${form.environment} aktif untuk runtime payment.`,
      });
    } catch (error) {
      setMessage({ type:'error', text:error instanceof Error ? error.message : 'Aktivasi gateway gagal' });
    } finally {
      setBusy('');
    }
  }

  const credentialFields: Array<{ key:keyof FormState; label:string; secret?:boolean; placeholder:string }> = [
    { key:'merchantName', label:'Name', placeholder:'PT Mandiri Semesta Gemilang' },
    { key:'clientId', label:'clientId', placeholder:'Masukkan Client ID' },
    { key:'clientSecret', label:'clientSecret', secret:true, placeholder:'Masukkan Client Secret' },
    { key:'partnerId', label:'partnerId', placeholder:'0041' },
    { key:'sourceId', label:'sourceId', placeholder:'MANDIRIS' },
    { key:'username', label:'username', placeholder:'Masukkan username merchant' },
    { key:'password', label:'password', secret:true, placeholder:'Masukkan password merchant' },
    { key:'merchantId', label:'merchantId', placeholder:'Masukkan Merchant ID' },
  ];

  const canActivate = form.provider === 'UNCONFIGURED'
    ? draftSaved && activationAcknowledged
    : draftSaved && executionReady && activationAcknowledged;

  return <div style={{ display:'grid', gap:16 }}>
    <div className="operations-summary-grid" style={{ margin:0 }}>
      <div><span>Runtime aktif</span><strong>{activeProvider}</strong><small>{activeProvider === 'UNCONFIGURED' ? 'Payment execution nonaktif' : activeEnvironment}</small></div>
      <div><span>Draft profile</span><strong>{form.provider}</strong><small>{form.environment}{isDraftDifferent ? ' · belum aktif' : ' · sama dengan runtime'}</small></div>
      <div><span>Activation</span><strong>{server?.activatedAt ? 'RECORDED' : 'LEGACY'}</strong><small>{server?.activatedAt ? new Date(server.activatedAt).toLocaleString('id-ID') : 'Belum ada explicit activation'}</small></div>
    </div>

    <div className="app-notice-bubble" role="note">
      <strong>Configure → Save Draft → Test → Activate</strong>
      <span>Save dan Test tidak mengubah environment runtime. Production hanya aktif setelah test execution-ready dan aktivasi eksplisit oleh Super Admin.</span>
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
      <strong>Production profile belum aktif hanya karena dipilih</strong>
      <span>Credential Production terisolasi dari UAT. Runtime tetap pada profile aktif sampai tombol Activate Production dijalankan setelah test berhasil.</span>
    </div> : null}

    {form.provider === 'E2PAY' ? <div className="settings-form-grid">
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
    </div> : null}

    <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
      <button type="button" className="btn btn-primary" disabled={loading || Boolean(busy)} onClick={() => void save()}>
        {busy === 'save' ? 'Menyimpan…' : 'Save Draft'}
      </button>
      <button type="button" className="btn" disabled={loading || Boolean(busy) || form.provider !== 'E2PAY' || !draftSaved} onClick={() => void testConnection()}>
        {busy === 'test' ? 'Menguji…' : 'Test Connection'}
      </button>
      <button type="button" className="btn" disabled={loading || Boolean(busy)} onClick={() => void load()}>
        Refresh
      </button>
    </div>

    {message ? <div className={'settings-status ' + message.type} role="status">{message.text}</div> : null}

    {connection ? <div className="card" style={{ padding:14, display:'grid', gap:6 }}>
      <strong style={{ fontSize:12 }}>E2Pay Connection Test · non-persistent</strong>
      <span style={{ fontSize:11.5, color:'var(--text3)' }}>Host authorization: {connection.hostAuthorized ? 'SUCCESS' : 'FAILED'}</span>
      <span style={{ fontSize:11.5, color:'var(--text3)' }}>Merchant login: {connection.merchantLoginAuthorized ? 'SUCCESS' : 'NOT TESTED'}</span>
      <span style={{ fontSize:11.5, color:'var(--text3)' }}>Merchant: {connection.merchantName || '-'} {connection.merchantStatus ? '· ' + connection.merchantStatus : ''}</span>
      <span style={{ fontSize:11.5, color:'var(--text3)' }}>Merchant ID: {connection.merchantId || '-'}</span>
      <span style={{ fontSize:11.5, color:'var(--text3)' }}>Partner ID: {connection.partnerId || '-'}</span>
      <span style={{ fontSize:11.5, color:'var(--text3)' }}>Source ID: {connection.sourceId || '-'}</span>
      <span style={{ fontSize:11.5, color:'var(--text3)' }}>Source account: {connection.accountSrcMasked || 'belum ditemukan'}</span>
      <span style={{ fontSize:11.5, color:'var(--text3)' }}>Bank directory: {connection.bankCount || 0} bank</span>
      <span style={{ fontSize:11.5, color:'var(--text3)' }}>{connection.nextStep}</span>
    </div> : null}

    {draftSaved ? <div className="card" style={{ padding:14, display:'grid', gap:10 }}>
      <strong style={{ fontSize:12 }}>{form.provider === 'UNCONFIGURED' ? 'Deactivate Payment Gateway' : `Activate ${form.environment}`}</strong>
      <label style={{ display:'flex', gap:8, alignItems:'flex-start', fontSize:11.5, color:'var(--text3)' }}>
        <input type="checkbox" checked={activationAcknowledged} onChange={(event) => setActivationAcknowledged(event.target.checked)} />
        <span>Saya memahami bahwa aktivasi ini mengubah profile runtime yang digunakan untuk payment execution.</span>
      </label>
      <button type="button" className={form.environment === 'PRODUCTION' && form.provider !== 'UNCONFIGURED' ? 'btn' : 'btn btn-primary'} disabled={!canActivate || Boolean(busy)} onClick={() => void activate()}>
        {busy === 'activate' ? 'Mengaktifkan…' : form.provider === 'UNCONFIGURED' ? 'Deactivate Gateway' : `Activate ${form.environment}`}
      </button>
      {form.provider === 'E2PAY' && !executionReady ? <small style={{ color:'var(--text3)' }}>Aktivasi dikunci sampai Test Connection menyatakan profile execution-ready.</small> : null}
    </div> : null}

    <div style={{ borderTop:'1px solid var(--border-soft)', paddingTop:12, color:'var(--text3)', fontSize:11.5, lineHeight:1.6 }}>
      Credential disimpan terenkripsi di server. Password merchant dinormalisasi menjadi MD5 uppercase di backend dan tidak dikirim kembali ke browser. Test Connection tidak menyimpan source account atau mengubah runtime; source account baru dipersist saat aktivasi eksplisit berhasil.
      {server?.updatedAt ? <div>Last draft update: {new Date(server.updatedAt).toLocaleString('id-ID')} · {server.updatedBy || '-'}</div> : null}
      {server?.activatedAt ? <div>Last activation: {new Date(server.activatedAt).toLocaleString('id-ID')} · {server.activatedBy || '-'}</div> : null}
    </div>
  </div>;
}

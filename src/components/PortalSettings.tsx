'use client';

import { useCallback, useEffect, useState, type CSSProperties } from 'react';

type Policy = {
  enabled: boolean;
  feeRate: number;
  minFee: number;
  minFeeAmount: number;
  maxPercent: number;
  maxTenorMonths: number;
  minDaysWorked: number;
  minTenureMonths: number;
};

type Copy = {
  companyTagline: string;
  heroSubtitle: string;
  ewaTitle: string;
  ewaSubtitle: string;
  ewaBody: string;
  ewaCta: string;
  ewaLimitCaption: string;
};

type Ad = {
  id?: string;
  enabled: boolean;
  sortOrder: number;
  placement: string;
  provider: string;
  action: string;
  tag: string;
  title: string;
  desc: string;
  cta: string;
  href: string;
  bg: string;
  imageUrl: string;
  impressionUrl: string;
  clickUrl: string;
};

type AdsPlatform = {
  provider: string;
  accountId: string;
  pixelId: string;
  conversionLabel: string;
  impressionUrl: string;
};

type Client = { id: string; code?: string; name: string };

const EMPTY_AD: Ad = {
  enabled: true,
  sortOrder: 0,
  placement: 'HOME',
  provider: 'INTERNAL',
  action: 'EWA',
  tag: 'Advance Salary',
  title: 'Get Paid Sooner, Worry Less',
  desc: 'Cairkan gaji yang sudah Anda kerjakan. Pengajuan diproses sesuai kebijakan perusahaan.',
  cta: 'Request Advance',
  href: '',
  bg: 'linear-gradient(115deg, #0f1b3a 0%, #1b2a52 55%, #24355f 100%)',
  imageUrl: '',
  impressionUrl: '',
  clickUrl: '',
};

const EMPTY_PLATFORM: AdsPlatform = {
  provider: 'NONE',
  accountId: '',
  pixelId: '',
  conversionLabel: '',
  impressionUrl: '',
};

const IDR = new Intl.NumberFormat('id-ID');

function asPlatform(input: unknown): AdsPlatform {
  const value = (input && typeof input === 'object' ? input : {}) as Partial<AdsPlatform>;
  return {
    provider: value.provider || EMPTY_PLATFORM.provider,
    accountId: value.accountId || '',
    pixelId: value.pixelId || '',
    conversionLabel: value.conversionLabel || '',
    impressionUrl: value.impressionUrl || '',
  };
}

export default function PortalSettings() {
  const [tab, setTab] = useState<'rules' | 'ads' | 'copy' | 'platform'>('rules');
  const [clientId, setClientId] = useState('');
  const [clients, setClients] = useState<Client[]>([]);
  const [inherited, setInherited] = useState(true);
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [copy, setCopy] = useState<Copy | null>(null);
  const [adsEnabled, setAdsEnabled] = useState(true);
  const [ads, setAds] = useState<Ad[]>([{ ...EMPTY_AD }]);
  const [platform, setPlatform] = useState<AdsPlatform>(EMPTY_PLATFORM);
  const [message, setMessage] = useState('');
  const [ok, setOk] = useState('');
  const [busy, setBusy] = useState(false);

  const apply = useCallback((data: Record<string, unknown>) => {
    setClients((data.clients as Client[]) || []);
    setInherited(Boolean(data.inherited));
    setPolicy(data.policy as Policy);
    setCopy(data.copy as Copy);
    setAdsEnabled((data.features as { adsEnabled?: boolean })?.adsEnabled !== false);
    setAds(((data.ads as Ad[]) || []).map((ad, index) => ({ ...EMPTY_AD, ...ad, sortOrder: index })));
    setPlatform(asPlatform(data.adsPlatform));
  }, []);

  const load = useCallback(async (nextClient: string) => {
    setMessage('');
    setOk('');
    const query = nextClient ? `?clientId=${encodeURIComponent(nextClient)}` : '';
    const response = await fetch(`/api/portal-settings${query}`);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    apply(data);
  }, [apply]);

  useEffect(() => {
    void load('').catch((error) => setMessage(error instanceof Error ? error.message : 'Gagal memuat'));
  }, [load]);

  async function save() {
    if (!policy || !copy || busy) return;
    setBusy(true);
    setMessage('');
    setOk('');
    try {
      const response = await fetch('/api/portal-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: clientId || null,
          policy,
          copy,
          features: { adsEnabled },
          adsPlatform: platform,
          ads: ads.map((ad, index) => ({ ...ad, sortOrder: index })),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      apply(data);
      setOk('Tersimpan. Portal karyawan memakai aturan ini pada muatan berikutnya.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Gagal menyimpan');
    } finally {
      setBusy(false);
    }
  }

  async function resetClient() {
    if (!clientId || busy) return;
    if (!window.confirm('Hapus pengaturan khusus klien ini dan kembali ke default organisasi?')) return;
    setBusy(true);
    try {
      const response = await fetch('/api/portal-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, reset: true }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      apply(data);
      setOk('Override klien dihapus. Portal memakai default organisasi.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Gagal mereset');
    } finally {
      setBusy(false);
    }
  }

  async function onClientChange(value: string) {
    setClientId(value);
    try {
      await load(value);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Gagal memuat');
    }
  }

  if (!policy || !copy) {
    return <p style={{ color: 'var(--text3)' }}>{message || 'Memuat pengaturan portal…'}</p>;
  }

  return (
    <section>
      <div className="page-heading">
        <div>
          <p style={{ margin: 0, fontSize: 11, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--text3)' }}>Employee portal</p>
          <h1>Portal Settings</h1>
          <p>Aturan advance, banner, dan teks ESS diatur di sini. Tidak mengubah pay run, PI, atau billing.</p>
        </div>
        <span className="status-pill">{inherited ? 'Default organisasi' : 'Tersimpan'}</span>
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
        <label style={{ fontSize: 12, color: 'var(--text2)' }}>
          Lingkup
          <select
            value={clientId}
            onChange={(event) => void onClientChange(event.target.value)}
            style={{ marginLeft: 8, minWidth: 240 }}
          >
            <option value="">Semua klien (default org)</option>
            {clients.map((client) => (
              <option key={client.id} value={client.id}>{client.name} ({client.code || client.id})</option>
            ))}
          </select>
        </label>
        {clientId ? (
          <button type="button" className="btn" disabled={busy} onClick={() => void resetClient()}>Pakai default org</button>
        ) : null}
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        {([
          ['rules', 'Aturan advance'],
          ['ads', 'Banner / iklan'],
          ['copy', 'Teks portal'],
          ['platform', 'Ads platform'],
        ] as const).map(([id, label]) => (
          <button key={id} type="button" className={`btn${tab === id ? ' btn-primary' : ''}`} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>

      {message ? <p className="app-notice-bubble app-notice-error" role="status">{message}</p> : null}
      {ok ? <p className="app-notice-bubble" role="status">{ok}</p> : null}

      {tab === 'rules' ? (
        <div className="card" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14, padding: 18 }}>
          <label style={field}>
            Advance salary
            <select value={policy.enabled ? '1' : '0'} onChange={(event) => setPolicy({ ...policy, enabled: event.target.value === '1' })}>
              <option value="1">Aktif di portal</option>
              <option value="0">Nonaktif</option>
            </select>
          </label>
          <label style={field}>
            Plafond maksimal (% gaji berjalan)
            <input type="number" min={5} max={100} step={1} value={Math.round(policy.maxPercent * 100)}
              onChange={(event) => setPolicy({ ...policy, maxPercent: Number(event.target.value) / 100 })} />
          </label>
          <label style={field}>
            Fee layanan (%)
            <input type="number" min={0} max={50} step={0.1} value={Number((policy.feeRate * 100).toFixed(2))}
              onChange={(event) => setPolicy({ ...policy, feeRate: Number(event.target.value) / 100 })} />
          </label>
          <label style={field}>
            Fee minimum (Rp)
            <input type="number" min={0} step={1000} value={policy.minFee}
              onChange={(event) => setPolicy({ ...policy, minFee: Number(event.target.value) || 0 })} />
          </label>
          <label style={field}>
            Fee minimum berlaku jika pengajuan ≤ (Rp)
            <input type="number" min={0} step={10000} value={policy.minFeeAmount}
              onChange={(event) => setPolicy({ ...policy, minFeeAmount: Number(event.target.value) || 0 })} />
          </label>
          <label style={field}>
            Minimal hari kerja di periode ini
            <input type="number" min={0} max={31} value={policy.minDaysWorked}
              onChange={(event) => setPolicy({ ...policy, minDaysWorked: Number(event.target.value) || 0 })} />
          </label>
          <label style={field}>
            Minimal masa kerja (bulan)
            <input type="number" min={0} max={60} value={policy.minTenureMonths}
              onChange={(event) => setPolicy({ ...policy, minTenureMonths: Number(event.target.value) || 0 })} />
          </label>
          <label style={field}>
            Tenor (bulan, 1 = potong saat gajian)
            <input type="number" min={1} max={6} value={policy.maxTenorMonths}
              onChange={(event) => setPolicy({ ...policy, maxTenorMonths: Number(event.target.value) || 1 })} />
          </label>
          <p style={{ gridColumn: '1 / -1', margin: 0, fontSize: 12, color: 'var(--text3)' }}>
            Contoh: plafond {Math.round(policy.maxPercent * 100)}% · fee {Number((policy.feeRate * 100).toFixed(2))}%
            (min Rp {IDR.format(policy.minFee)} jika cair ≤ Rp {IDR.format(policy.minFeeAmount)}).
            Plafond dan fee dihitung di server, bukan di LLM.
          </p>
        </div>
      ) : null}

      {tab === 'ads' ? (
        <div>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12, fontSize: 13 }}>
            <input type="checkbox" checked={adsEnabled} onChange={(event) => setAdsEnabled(event.target.checked)} />
            Tampilkan banner di portal
          </label>
          {ads.map((ad, index) => (
            <div key={ad.id || index} className="card" style={{ padding: 16, marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                <strong>Banner {index + 1}</strong>
                <span style={{ display: 'flex', gap: 6 }}>
                  <button type="button" className="btn" disabled={index === 0} onClick={() => setAds(move(ads, index, -1))}>Naik</button>
                  <button type="button" className="btn" disabled={index === ads.length - 1} onClick={() => setAds(move(ads, index, 1))}>Turun</button>
                  <button type="button" className="btn" onClick={() => setAds(ads.filter((_, i) => i !== index))}>Hapus</button>
                </span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
                <label style={field}>Tag<input value={ad.tag} onChange={(event) => patchAd(setAds, ads, index, { tag: event.target.value })} /></label>
                <label style={field}>Judul<input value={ad.title} onChange={(event) => patchAd(setAds, ads, index, { title: event.target.value })} /></label>
                <label style={field}>Tombol CTA<input value={ad.cta} onChange={(event) => patchAd(setAds, ads, index, { cta: event.target.value })} /></label>
                <label style={field}>
                  Penempatan
                  <select value={ad.placement} onChange={(event) => patchAd(setAds, ads, index, { placement: event.target.value })}>
                    <option value="HOME">Beranda</option>
                    <option value="EWA">Kartu Advance</option>
                    <option value="PAYSLIP">Riwayat slip</option>
                  </select>
                </label>
                <label style={field}>
                  Aksi tombol
                  <select value={ad.action} onChange={(event) => patchAd(setAds, ads, index, { action: event.target.value, provider: event.target.value === 'EXTERNAL' ? 'EXTERNAL' : 'INTERNAL' })}>
                    <option value="EWA">Buka Advance Salary</option>
                    <option value="PAYSLIP">Buka riwayat slip</option>
                    <option value="EXTERNAL">Buka tautan eksternal</option>
                    <option value="NONE">Hanya tampil</option>
                  </select>
                </label>
                <label style={{ ...field, gridColumn: '1 / -1' }}>Deskripsi<textarea value={ad.desc} rows={2} onChange={(event) => patchAd(setAds, ads, index, { desc: event.target.value })} /></label>
                {ad.action === 'EXTERNAL' ? (
                  <label style={{ ...field, gridColumn: '1 / -1' }}>Tautan eksternal (https)
                    <input value={ad.href} placeholder="https://…" onChange={(event) => patchAd(setAds, ads, index, { href: event.target.value })} />
                  </label>
                ) : null}
                <label style={field}>Warna / gradient<input value={ad.bg} onChange={(event) => patchAd(setAds, ads, index, { bg: event.target.value })} /></label>
                <label style={field}>Gambar (https, opsional)<input value={ad.imageUrl} onChange={(event) => patchAd(setAds, ads, index, { imageUrl: event.target.value })} /></label>
                <label style={field}>Pixel tayang (opsional)<input value={ad.impressionUrl} onChange={(event) => patchAd(setAds, ads, index, { impressionUrl: event.target.value })} /></label>
                <label style={field}>URL klik / tracker (opsional)<input value={ad.clickUrl} onChange={(event) => patchAd(setAds, ads, index, { clickUrl: event.target.value })} /></label>
                <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
                  <input type="checkbox" checked={ad.enabled} onChange={(event) => patchAd(setAds, ads, index, { enabled: event.target.checked })} />
                  Aktif
                </label>
              </div>
            </div>
          ))}
          {ads.length < 8 ? (
            <button type="button" className="btn" onClick={() => setAds([...ads, { ...EMPTY_AD, sortOrder: ads.length }])}>Tambah banner</button>
          ) : null}
        </div>
      ) : null}

      {tab === 'copy' ? (
        <div className="card" style={{ display: 'grid', gap: 12, padding: 18 }}>
          <label style={field}>Tagline perusahaan<input value={copy.companyTagline} onChange={(event) => setCopy({ ...copy, companyTagline: event.target.value })} /></label>
          <label style={field}>Subjudul beranda<input value={copy.heroSubtitle} onChange={(event) => setCopy({ ...copy, heroSubtitle: event.target.value })} /></label>
          <label style={field}>Judul kartu advance<input value={copy.ewaTitle} onChange={(event) => setCopy({ ...copy, ewaTitle: event.target.value })} /></label>
          <label style={field}>Subjudul kartu advance<input value={copy.ewaSubtitle} onChange={(event) => setCopy({ ...copy, ewaSubtitle: event.target.value })} /></label>
          <label style={field}>Isi kartu advance<textarea rows={3} value={copy.ewaBody} onChange={(event) => setCopy({ ...copy, ewaBody: event.target.value })} /></label>
          <label style={field}>Teks tombol advance<input value={copy.ewaCta} onChange={(event) => setCopy({ ...copy, ewaCta: event.target.value })} /></label>
          <label style={field}>Keterangan plafond (pakai {'{percent}'})<input value={copy.ewaLimitCaption} onChange={(event) => setCopy({ ...copy, ewaLimitCaption: event.target.value })} /></label>
        </div>
      ) : null}

      {tab === 'platform' ? (
        <div className="card" style={{ display: 'grid', gap: 12, padding: 18, maxWidth: 560 }}>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text2)' }}>
            Integrasi iklan memakai pixel gambar (1×1), bukan skrip pihak ketiga. Ini aman untuk portal karyawan.
          </p>
          <label style={field}>
            Provider
            <select value={platform.provider} onChange={(event) => setPlatform({ ...platform, provider: event.target.value })}>
              <option value="NONE">Tidak ada</option>
              <option value="GENERIC">Pixel URL sendiri</option>
              <option value="GOOGLE_ADS">Google Ads (conversion noscript)</option>
              <option value="META">Meta Pixel (noscript)</option>
            </select>
          </label>
          {platform.provider === 'GOOGLE_ADS' ? (
            <>
              <label style={field}>Conversion ID<input value={platform.accountId} onChange={(event) => setPlatform({ ...platform, accountId: event.target.value })} /></label>
              <label style={field}>Conversion label<input value={platform.conversionLabel} onChange={(event) => setPlatform({ ...platform, conversionLabel: event.target.value })} /></label>
            </>
          ) : null}
          {platform.provider === 'META' ? (
            <label style={field}>Pixel ID<input value={platform.pixelId} onChange={(event) => setPlatform({ ...platform, pixelId: event.target.value })} /></label>
          ) : null}
          {platform.provider === 'GENERIC' ? (
            <label style={field}>URL pixel tayang (https)<input value={platform.impressionUrl} onChange={(event) => setPlatform({ ...platform, impressionUrl: event.target.value })} /></label>
          ) : null}
        </div>
      ) : null}

      <div style={{ marginTop: 16 }}>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void save()}>
          {busy ? 'Menyimpan…' : 'Simpan pengaturan portal'}
        </button>
      </div>
    </section>
  );
}

const field: CSSProperties = { display: 'grid', gap: 6, fontSize: 12, fontWeight: 650, color: 'var(--text2)' };

function patchAd(setAds: (ads: Ad[]) => void, ads: Ad[], index: number, patch: Partial<Ad>) {
  setAds(ads.map((ad, i) => (i === index ? { ...ad, ...patch } : ad)));
}

function move(ads: Ad[], index: number, delta: number) {
  const next = [...ads];
  const target = index + delta;
  if (target < 0 || target >= next.length) return ads;
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

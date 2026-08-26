import { d1All, d1First, d1Run } from './_d1.js';
import { DEFAULT_EWA_POLICY, policyToRules } from './_ewa.js';

export const DEFAULT_PORTAL_COPY = Object.freeze({
  companyTagline: 'Payroll & HR Digital',
  heroSubtitle: 'Your pay hub — all your payroll info in one place',
  ewaTitle: 'Advance Salary',
  ewaSubtitle: 'Cairkan gaji yang sudah Anda kerjakan, tanpa menunggu gajian',
  ewaBody: 'Cairkan gaji yang sudah Anda kerjakan tanpa agunan. Biaya layanan transparan dan dipotong otomatis saat gajian.',
  ewaCta: 'Request Advance',
  ewaLimitCaption: "Up to {percent}% of this month's pay",
});

export const DEFAULT_PORTAL_FEATURES = Object.freeze({
  adsEnabled: true,
});

export const DEFAULT_ADS_PLATFORM = Object.freeze({
  provider: 'NONE',
  accountId: '',
  pixelId: '',
  conversionLabel: '',
  impressionUrl: '',
});

export const DEFAULT_PORTAL_AD = Object.freeze({
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
});

const TEXT_LIMITS = {
  companyTagline: 120,
  heroSubtitle: 160,
  ewaTitle: 60,
  ewaSubtitle: 160,
  ewaBody: 280,
  ewaCta: 40,
  ewaLimitCaption: 80,
  tag: 40,
  title: 80,
  desc: 200,
  cta: 40,
  bg: 240,
  accountId: 80,
  pixelId: 80,
  conversionLabel: 80,
};

function clip(value, max) {
  return String(value || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
}

export function sanitizeHttpUrl(value) {
  const raw = String(value || '').trim().slice(0, 500);
  if (!raw) return '';
  if (raw.startsWith('/api/portal-media?key=portal-media%2F')) return raw;
  if (/^\s*(javascript|data|vbscript|file):/i.test(raw)) return '';
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
    return url.toString();
  } catch {
    return '';
  }
}

export function sanitizeBg(value) {
  const raw = String(value || '').trim().slice(0, TEXT_LIMITS.bg);
  if (!raw) return DEFAULT_PORTAL_AD.bg;
  if (/javascript:|expression\(|url\s*\(|<|>/i.test(raw)) return DEFAULT_PORTAL_AD.bg;
  if (/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(raw)) return raw;
  if (/^linear-gradient\([^;<>]+\)$/i.test(raw)) return raw;
  return DEFAULT_PORTAL_AD.bg;
}

function parseJson(raw, fallback) {
  try {
    const parsed = JSON.parse(raw || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : { ...fallback };
  } catch {
    return { ...fallback };
  }
}

export function sanitizeCopy(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const out = {};
  for (const [key, max] of Object.entries(TEXT_LIMITS)) {
    if (!(key in DEFAULT_PORTAL_COPY)) continue;
    out[key] = clip(source[key] ?? DEFAULT_PORTAL_COPY[key], max) || DEFAULT_PORTAL_COPY[key];
  }
  return out;
}

export function sanitizeFeatures(input = {}) {
  return { adsEnabled: input?.adsEnabled !== false && input?.adsEnabled !== 0 };
}

export function sanitizeAdsPlatform(input = {}) {
  const provider = String(input?.provider || 'NONE').toUpperCase();
  const allowed = new Set(['NONE', 'GENERIC', 'GOOGLE_ADS', 'META']);
  return {
    provider: allowed.has(provider) ? provider : 'NONE',
    accountId: clip(input?.accountId, TEXT_LIMITS.accountId),
    pixelId: clip(input?.pixelId, TEXT_LIMITS.pixelId),
    conversionLabel: clip(input?.conversionLabel, TEXT_LIMITS.conversionLabel),
    impressionUrl: sanitizeHttpUrl(input?.impressionUrl),
  };
}

export function sanitizePolicy(input = {}) {
  const feeRate = Number(input.feeRate ?? input.fee_rate);
  const maxPercent = Number(input.maxPercent ?? input.max_percent);
  const minFee = Math.round(Number(input.minFee ?? input.min_fee));
  const minFeeAmount = Math.round(Number(input.minFeeAmount ?? input.min_fee_amount));
  const minDaysWorked = Math.round(Number(input.minDaysWorked ?? input.min_days_worked));
  const minTenureMonths = Math.round(Number(input.minTenureMonths ?? input.min_tenure_months));
  const minTenureDays = Math.round(Number(input.minTenureDays ?? input.min_tenure_days));
  const maxTenorMonths = Math.round(Number(input.maxTenorMonths ?? input.max_tenor_months));
  const enabled = input.enabled === false || input.enabled === 0 ? 0 : 1;
  return {
    enabled,
    fee_rate: Math.min(0.5, Math.max(0, Number.isFinite(feeRate) ? feeRate : DEFAULT_EWA_POLICY.fee_rate)),
    min_fee: Math.min(2_000_000, Math.max(0, Number.isFinite(minFee) ? minFee : DEFAULT_EWA_POLICY.min_fee)),
    min_fee_amount: Math.min(20_000_000, Math.max(0, Number.isFinite(minFeeAmount) ? minFeeAmount : DEFAULT_EWA_POLICY.min_fee_amount)),
    max_percent: Math.min(1, Math.max(0.05, Number.isFinite(maxPercent) ? maxPercent : DEFAULT_EWA_POLICY.max_percent)),
    max_tenor_months: Math.min(6, Math.max(1, Number.isFinite(maxTenorMonths) ? maxTenorMonths : 1)),
    min_days_worked: Math.min(31, Math.max(0, Number.isFinite(minDaysWorked) ? minDaysWorked : DEFAULT_EWA_POLICY.min_days_worked)),
    min_tenure_months: Math.min(60, Math.max(0, Number.isFinite(minTenureMonths) ? minTenureMonths : DEFAULT_EWA_POLICY.min_tenure_months)),
    min_tenure_days: Math.min(3650, Math.max(0, Number.isFinite(minTenureDays) ? minTenureDays : DEFAULT_EWA_POLICY.min_tenure_days)),
  };
}

const ACTIONS = new Set(['NONE', 'EWA', 'PAYSLIP', 'EXTERNAL']);
const PLACEMENTS = new Set(['HOME', 'EWA', 'PAYSLIP']);
const PROVIDERS = new Set(['INTERNAL', 'EXTERNAL', 'PIXEL']);

export function sanitizeAd(input = {}, index = 0) {
  const action = ACTIONS.has(String(input.action || '').toUpperCase())
    ? String(input.action).toUpperCase()
    : (sanitizeHttpUrl(input.href) ? 'EXTERNAL' : 'EWA');
  const provider = PROVIDERS.has(String(input.provider || '').toUpperCase())
    ? String(input.provider).toUpperCase()
    : (action === 'EXTERNAL' ? 'EXTERNAL' : 'INTERNAL');
  const placement = PLACEMENTS.has(String(input.placement || '').toUpperCase())
    ? String(input.placement).toUpperCase()
    : 'HOME';
  const href = action === 'EXTERNAL' ? sanitizeHttpUrl(input.href) : '';
  return {
    id: String(input.id || '').slice(0, 40) || `ADS-${crypto.randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase()}`,
    enabled: input.enabled === false || input.enabled === 0 ? 0 : 1,
    sort_order: Number.isFinite(Number(input.sortOrder ?? input.sort_order)) ? Number(input.sortOrder ?? input.sort_order) : index,
    placement,
    provider,
    action,
    tag: clip(input.tag, TEXT_LIMITS.tag) || DEFAULT_PORTAL_AD.tag,
    title: clip(input.title, TEXT_LIMITS.title) || DEFAULT_PORTAL_AD.title,
    description: clip(input.desc ?? input.description, TEXT_LIMITS.desc) || DEFAULT_PORTAL_AD.desc,
    cta: clip(input.cta, TEXT_LIMITS.cta) || DEFAULT_PORTAL_AD.cta,
    href,
    bg: sanitizeBg(input.bg),
    image_url: sanitizeHttpUrl(input.imageUrl ?? input.image_url),
    impression_url: sanitizeHttpUrl(input.impressionUrl ?? input.impression_url),
    click_url: sanitizeHttpUrl(input.clickUrl ?? input.click_url),
  };
}

export function adToPublic(row) {
  return {
    id: row.id,
    enabled: Boolean(Number(row.enabled)),
    sortOrder: Number(row.sort_order || 0),
    placement: row.placement || 'HOME',
    provider: row.provider || 'INTERNAL',
    action: row.action || 'EWA',
    tag: row.tag || '',
    title: row.title || '',
    desc: row.description || '',
    cta: row.cta || '',
    href: row.href || '',
    bg: row.bg || DEFAULT_PORTAL_AD.bg,
    imageUrl: row.image_url || '',
    impressionUrl: row.impression_url || '',
    clickUrl: row.click_url || '',
  };
}

function scopeSql(clientId) {
  return clientId ? 'org_id=? AND client_id=?' : "org_id=? AND client_id IS NULL";
}

function scopeBindings(orgId, clientId) {
  return clientId ? [orgId, clientId] : [orgId];
}

export async function loadPortalPresentation(database, orgId, clientId) {
  const empty = {
    copy: { ...DEFAULT_PORTAL_COPY },
    features: { ...DEFAULT_PORTAL_FEATURES },
    adsPlatform: { ...DEFAULT_ADS_PLATFORM },
    ads: [{ ...DEFAULT_PORTAL_AD }],
    policy: { ...DEFAULT_EWA_POLICY, org_id: orgId },
    inherited: true,
  };
  if (!database || !orgId) return empty;
  try {
    const settings = (clientId
      ? await d1First(database, 'SELECT * FROM portal_settings WHERE org_id=? AND client_id=? LIMIT 1', [orgId, clientId])
      : null)
      || await d1First(database, 'SELECT * FROM portal_settings WHERE org_id=? AND client_id IS NULL LIMIT 1', [orgId]);
    const policy = (clientId
      ? await d1First(database, 'SELECT * FROM ewa_policies WHERE org_id=? AND client_id=? LIMIT 1', [orgId, clientId])
      : null)
      || await d1First(database, 'SELECT * FROM ewa_policies WHERE org_id=? AND client_id IS NULL LIMIT 1', [orgId])
      || { ...DEFAULT_EWA_POLICY, org_id: orgId };

    const clientAds = clientId
      ? await d1All(
        database,
        `SELECT * FROM portal_ads WHERE org_id=? AND client_id=? AND enabled=1
          ORDER BY sort_order ASC, created_at ASC LIMIT 8`,
        [orgId, clientId],
      )
      : [];
    const orgAds = await d1All(
      database,
      `SELECT * FROM portal_ads WHERE org_id=? AND client_id IS NULL AND enabled=1
        ORDER BY sort_order ASC, created_at ASC LIMIT 8`,
      [orgId],
    );
    const ads = (clientAds.length ? clientAds : orgAds).map(adToPublic);
    const copy = sanitizeCopy(settings ? parseJson(settings.copy_json, DEFAULT_PORTAL_COPY) : DEFAULT_PORTAL_COPY);
    const features = sanitizeFeatures(settings ? parseJson(settings.features_json, DEFAULT_PORTAL_FEATURES) : DEFAULT_PORTAL_FEATURES);
    const adsPlatform = sanitizeAdsPlatform(settings ? parseJson(settings.ads_platform_json, DEFAULT_ADS_PLATFORM) : DEFAULT_ADS_PLATFORM);
    return {
      copy,
      features,
      adsPlatform,
      ads: features.adsEnabled ? (ads.length ? ads : [{ ...DEFAULT_PORTAL_AD }]) : [],
      policy,
      inherited: !settings && !clientAds.length,
    };
  } catch (error) {
    if (/no such table/i.test(String(error?.message || error))) return empty;
    throw error;
  }
}

export async function loadPortalSettingsForOps(database, orgId, clientId) {
  const presentation = await loadPortalPresentation(database, orgId, clientId);
  let settingsRow = null;
  let adsRows = [];
  let policyRow = null;
  try {
    settingsRow = clientId
      ? await d1First(database, 'SELECT * FROM portal_settings WHERE org_id=? AND client_id=? LIMIT 1', [orgId, clientId])
      : await d1First(database, 'SELECT * FROM portal_settings WHERE org_id=? AND client_id IS NULL LIMIT 1', [orgId]);
    policyRow = clientId
      ? await d1First(database, 'SELECT * FROM ewa_policies WHERE org_id=? AND client_id=? LIMIT 1', [orgId, clientId])
      : await d1First(database, 'SELECT * FROM ewa_policies WHERE org_id=? AND client_id IS NULL LIMIT 1', [orgId]);
    adsRows = await d1All(
      database,
      `SELECT * FROM portal_ads WHERE ${scopeSql(clientId)} ORDER BY sort_order ASC, created_at ASC LIMIT 8`,
      scopeBindings(orgId, clientId),
    );
  } catch (error) {
    if (!/no such table/i.test(String(error?.message || error))) throw error;
  }
  const inherited = !settingsRow && !policyRow && !adsRows.length;
  return {
    clientId: clientId || null,
    inherited,
    policy: policyToRules(policyRow || presentation.policy),
    copy: settingsRow ? sanitizeCopy(parseJson(settingsRow.copy_json, DEFAULT_PORTAL_COPY)) : presentation.copy,
    features: settingsRow ? sanitizeFeatures(parseJson(settingsRow.features_json, DEFAULT_PORTAL_FEATURES)) : presentation.features,
    adsPlatform: settingsRow ? sanitizeAdsPlatform(parseJson(settingsRow.ads_platform_json, DEFAULT_ADS_PLATFORM)) : presentation.adsPlatform,
    ads: adsRows.length ? adsRows.map(adToPublic) : [{ ...DEFAULT_PORTAL_AD, id: '' }],
  };
}

export async function savePortalSettings(database, { orgId, clientId, actor, policy, copy, features, adsPlatform, ads, reset }) {
  const nowActor = actor?.email || actor?.id || 'ops';
  if (reset && clientId) {
    await d1Run(database, 'DELETE FROM portal_ads WHERE org_id=? AND client_id=?', [orgId, clientId]);
    await d1Run(database, 'DELETE FROM portal_settings WHERE org_id=? AND client_id=?', [orgId, clientId]);
    await d1Run(database, 'DELETE FROM ewa_policies WHERE org_id=? AND client_id=?', [orgId, clientId]);
    return loadPortalSettingsForOps(database, orgId, clientId);
  }

  const nextPolicy = sanitizePolicy(policy);
  const nextCopy = sanitizeCopy(copy);
  const nextFeatures = sanitizeFeatures(features);
  const nextPlatform = sanitizeAdsPlatform(adsPlatform);
  const nextAds = (Array.isArray(ads) ? ads : []).slice(0, 8).map((row, index) => sanitizeAd(row, index));

  const existingPolicy = await d1First(
    database,
    `SELECT id FROM ewa_policies WHERE ${scopeSql(clientId)} LIMIT 1`,
    scopeBindings(orgId, clientId),
  );
  if (existingPolicy) {
    await d1Run(
      database,
      `UPDATE ewa_policies SET enabled=?, fee_rate=?, min_fee=?, min_fee_amount=?, max_percent=?,
        max_tenor_months=?, min_days_worked=?, min_tenure_months=?, min_tenure_days=?,
        updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE id=?`,
      [
        nextPolicy.enabled, nextPolicy.fee_rate, nextPolicy.min_fee, nextPolicy.min_fee_amount, nextPolicy.max_percent,
        nextPolicy.max_tenor_months, nextPolicy.min_days_worked, nextPolicy.min_tenure_months, nextPolicy.min_tenure_days,
        existingPolicy.id,
      ],
    );
  } else {
    await d1Run(
      database,
      `INSERT INTO ewa_policies (
        id, org_id, client_id, enabled, fee_rate, min_fee, min_fee_amount, max_percent,
        max_tenor_months, min_days_worked, min_tenure_months, min_tenure_days
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        `EWP-${crypto.randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase()}`,
        orgId, clientId || null, nextPolicy.enabled, nextPolicy.fee_rate, nextPolicy.min_fee, nextPolicy.min_fee_amount,
        nextPolicy.max_percent, nextPolicy.max_tenor_months, nextPolicy.min_days_worked, nextPolicy.min_tenure_months,
        nextPolicy.min_tenure_days,
      ],
    );
  }

  const existingSettings = await d1First(
    database,
    `SELECT id FROM portal_settings WHERE ${scopeSql(clientId)} LIMIT 1`,
    scopeBindings(orgId, clientId),
  );
  const copyJson = JSON.stringify(nextCopy);
  const featuresJson = JSON.stringify(nextFeatures);
  const platformJson = JSON.stringify(nextPlatform);
  if (existingSettings) {
    await d1Run(
      database,
      `UPDATE portal_settings SET copy_json=?, features_json=?, ads_platform_json=?, updated_by=?,
        updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`,
      [copyJson, featuresJson, platformJson, nowActor, existingSettings.id],
    );
  } else {
    await d1Run(
      database,
      `INSERT INTO portal_settings (id, org_id, client_id, copy_json, features_json, ads_platform_json, updated_by)
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        `PST-${crypto.randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase()}`,
        orgId, clientId || null, copyJson, featuresJson, platformJson, nowActor,
      ],
    );
  }

  await d1Run(database, `DELETE FROM portal_ads WHERE ${scopeSql(clientId)}`, scopeBindings(orgId, clientId));
  for (const ad of nextAds) {
    await d1Run(
      database,
      `INSERT INTO portal_ads (
        id, org_id, client_id, enabled, sort_order, placement, provider, action, tag, title, description, cta,
        href, bg, image_url, impression_url, click_url
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        ad.id, orgId, clientId || null, ad.enabled, ad.sort_order, ad.placement, ad.provider, ad.action,
        ad.tag, ad.title, ad.description, ad.cta, ad.href || null, ad.bg, ad.image_url || null,
        ad.impression_url || null, ad.click_url || null,
      ],
    );
  }

  await d1Run(
    database,
    `INSERT INTO audit_logs (id, org_id, username, role, action, detail, entity)
      VALUES (?, ?, ?, ?, 'PORTAL_SETTINGS_SAVED', ?, 'portal_settings')`,
    [
      `AUD-${crypto.randomUUID()}`, orgId, nowActor, actor?.role || 'SUPER_ADMIN',
      `${clientId || 'ORG'} · EWA ${Math.round(nextPolicy.max_percent * 100)}% · ${nextAds.length} banner`,
    ],
  );
  return loadPortalSettingsForOps(database, orgId, clientId);
}

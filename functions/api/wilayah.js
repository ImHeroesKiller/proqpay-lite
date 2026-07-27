/**
 * POST /api/wilayah
 * Body:
 *   { "text": "Kabanjahe" }
 *   or { "lokasi": "...", "cabang": "...", "kotaUmk": "...", "unitKerja": "..." }
 *   or { "rows": [ { lokasi, cabang, kotaUmk }, ... ] }
 */
import {
  ROLES,
  authorize,
  enforceRateLimit,
  handlePreflight,
  secureJson,
} from './_security.js';

const METHODS = 'GET, POST, OPTIONS';

// Lightweight copy of mapping rules for edge (no TS import path issues)
const PROVINCE_CODES = {
  Aceh: '11',
  'Sumatera Utara': '12',
  'Sumatera Barat': '13',
  Riau: '14',
  Jambi: '15',
  'Sumatera Selatan': '16',
  Bengkulu: '17',
  Lampung: '18',
  'DKI Jakarta': '31',
  'Jawa Barat': '32',
  'Jawa Tengah': '33',
  'DI Yogyakarta': '34',
  'Jawa Timur': '35',
  Banten: '36',
  Bali: '51',
  'Nusa Tenggara Barat': '52',
  'Nusa Tenggara Timur': '53',
  'Kalimantan Barat': '61',
  'Kalimantan Tengah': '62',
  'Kalimantan Selatan': '63',
  'Kalimantan Timur': '64',
  'Sulawesi Utara': '71',
  'Sulawesi Tengah': '72',
  'Sulawesi Selatan': '73',
  'Sulawesi Tenggara': '74',
  Gorontalo: '75',
};

const RULES = [
  { keys: ['banda aceh', 'aceh besar', 'takengon', 'bireuen', 'aceh'], province: 'Aceh' },
  {
    keys: [
      'medan',
      'kabanjahe',
      'tanjung balai',
      'kisaran',
      'gunung sitoli',
      'nias',
      'pematang siantar',
      'deli serdang',
      'barumun',
      'samosir',
      'asahan',
      'tapanuli',
      'hco medan',
      'medan amplas',
    ],
    province: 'Sumatera Utara',
  },
  { keys: ['padang', 'sumatera barat', 'sumbar'], province: 'Sumatera Barat' },
  { keys: ['riau', 'pekanbaru'], province: 'Riau' },
  { keys: ['palembang', 'indralaya', 'gelumbang', 'ogan ilir', 'sumatera selatan'], province: 'Sumatera Selatan' },
  { keys: ['bengkulu', 'curup', 'rejang', 'lebong', 'seluma', 'kaur'], province: 'Bengkulu' },
  { keys: ['lampung', 'bandar lampung', 'natar', 'terbanggi', 'kalianda'], province: 'Lampung' },
  { keys: ['jakarta', 'dki'], province: 'DKI Jakarta' },
  { keys: ['bandung', 'tasikmalaya', 'cirebon', 'bogor', 'cihideung', 'jawa barat', 'jabar', 'hco bandung'], province: 'Jawa Barat' },
  { keys: ['semarang', 'jepara', 'batang', 'limpung', 'jawa tengah', 'jateng', 'dc semarang'], province: 'Jawa Tengah' },
  { keys: ['malang', 'jember', 'banyuwangi', 'surabaya', 'gambiran', 'jawa timur', 'jatim'], province: 'Jawa Timur' },
  { keys: ['denpasar', 'gianyar', 'klungkung', 'karangasem', 'blahbatuh', 'bali'], province: 'Bali' },
  { keys: ['soe', 'timor', 'kupang', 'ntt'], province: 'Nusa Tenggara Timur' },
  { keys: ['lombok', 'mataram', 'praya', 'ntb'], province: 'Nusa Tenggara Barat' },
  { keys: ['palangka', 'palangkaraya', 'kapuas', 'katingan', 'kalteng'], province: 'Kalimantan Tengah' },
  { keys: ['banjarmasin', 'banjar', 'barito', 'kalsel'], province: 'Kalimantan Selatan' },
  { keys: ['balikpapan', 'samarinda', 'tanah grogot', 'paser', 'kaltim'], province: 'Kalimantan Timur' },
  { keys: ['makassar', 'mamuju', 'sulsel'], province: 'Sulawesi Selatan' },
];

function norm(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function identifyProvince(...parts) {
  const blob = norm(parts.filter(Boolean).join(' '));
  if (!blob) {
    return { province: 'Tidak diketahui', provinceCode: null, confidence: 'low', source: 'fallback' };
  }

  for (const rule of RULES) {
    for (const key of rule.keys) {
      if (blob === key) {
        return {
          province: rule.province,
          provinceCode: PROVINCE_CODES[rule.province] || null,
          confidence: 'high',
          source: 'exact',
          matchedKey: key,
        };
      }
    }
  }

  const flat = RULES.flatMap((r) => r.keys.map((k) => ({ key: k, province: r.province }))).sort(
    (a, b) => b.key.length - a.key.length
  );

  for (const { key, province } of flat) {
    if (blob.includes(key)) {
      return {
        province,
        provinceCode: PROVINCE_CODES[province] || null,
        confidence: key.length >= 5 ? 'high' : 'medium',
        source: 'contains',
        matchedKey: key,
      };
    }
  }

  return { province: 'Tidak diketahui', provinceCode: null, confidence: 'low', source: 'fallback' };
}

function resolveWorkLocation(input) {
  const hit = identifyProvince(input.lokasi, input.cabang, input.kotaUmk, input.unitKerja, input.text);
  return {
    name: String(input.lokasi || input.cabang || input.text || 'UNKNOWN').trim(),
    unit_kerja: input.unitKerja || null,
    province: hit.province,
    provinceCode: hit.provinceCode,
    city_umk: input.kotaUmk || null,
    branch_name: input.cabang || null,
    identification: hit,
  };
}

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'OPTIONS') {
    return handlePreflight(request, env, METHODS);
  }

  if (request.method !== 'GET' && request.method !== 'POST') {
    return secureJson({ error: 'POST or GET only' }, 405, request, env, METHODS);
  }

  const authorization = await authorize(request, env, {
    roles: ROLES,
    mutating: request.method === 'POST',
    methods: METHODS,
  });
  if (authorization.response) return authorization.response;

  const rateLimited = await enforceRateLimit(
    request,
    env,
    authorization.actor,
    'wilayah-lookup',
    METHODS
  );
  if (rateLimited) return rateLimited;

  const respond = (data, status = 200) =>
    secureJson(data, status, request, env, METHODS);

  if (request.method === 'GET') {
    const url = new URL(request.url);
    const q = url.searchParams.get('q') || url.searchParams.get('text') || '';
    if (!q) return respond({ error: 'query q required' }, 400);
    return respond({ ok: true, result: resolveWorkLocation({ text: q }) });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return respond({ error: 'Invalid JSON' }, 400);
  }

  if (Array.isArray(body.rows)) {
    const results = body.rows.map((r) => resolveWorkLocation(r));
    const unknown = results.filter((r) => r.province === 'Tidak diketahui').length;
    return respond({ ok: true, count: results.length, unknown, results });
  }

  const result = resolveWorkLocation({
    text: body.text,
    lokasi: body.lokasi,
    cabang: body.cabang,
    kotaUmk: body.kotaUmk || body.kota_umk,
    unitKerja: body.unitKerja || body.unit_kerja,
  });

  return respond({ ok: true, result });
}

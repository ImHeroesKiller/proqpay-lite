/**
 * Identifikasi provinsi dari cabang / lokasi / kota UMK (data IAP).
 * Dipakai IDA + import HRIS sebelum menulis work_locations.
 */

export type WilayahHit = {
  province: string;
  confidence: 'high' | 'medium' | 'low';
  source: 'exact' | 'contains' | 'fallback';
  matchedKey?: string;
};

/** Keyword → Provinsi (urutan: spesifik dulu) */
const RULES: Array<{ keys: string[]; province: string }> = [
  // Aceh
  { keys: ['banda aceh', 'aceh besar', 'takengon', 'bireuen', 'aceh'], province: 'Aceh' },
  // Sumut
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
      'tanjung morawa',
      'barumun',
      'padang lawas',
      'samosir',
      'asahan',
      'tapanuli',
    ],
    province: 'Sumatera Utara',
  },
  // Sumbar
  { keys: ['padang', 'sumatera barat', 'sumbar'], province: 'Sumatera Barat' },
  // Riau
  { keys: ['riau', 'pekanbaru'], province: 'Riau' },
  // Sumsel / Palembang
  { keys: ['palembang', 'indralaya', 'gelumbang', 'ogan ilir', 'sumatera selatan'], province: 'Sumatera Selatan' },
  // Bengkulu
  { keys: ['bengkulu', 'curup', 'rejang', 'lebong', 'seluma', 'kaur'], province: 'Bengkulu' },
  // Lampung
  {
    keys: ['lampung', 'bandar lampung', 'natar', 'terbanggi', 'kalianda', 'sukoharjo lampung'],
    province: 'Lampung',
  },
  // Banten / Jakarta / Jabar
  { keys: ['jakarta', 'tangerang', 'bekasi', 'depok'], province: 'DKI Jakarta' },
  {
    keys: ['bandung', 'tasikmalaya', 'cirebon', 'bogor', 'karawang', 'cihideung', 'jawa barat', 'jabar'],
    province: 'Jawa Barat',
  },
  // Jateng
  {
    keys: ['semarang', 'jepara', 'batang', 'limpung', 'kudus', 'jawa tengah', 'jateng'],
    province: 'Jawa Tengah',
  },
  // Jatim
  {
    keys: ['malang', 'jember', 'banyuwangi', 'surabaya', 'gambiran', 'genteng', 'jawa timur', 'jatim'],
    province: 'Jawa Timur',
  },
  // Bali
  {
    keys: ['denpasar', 'gianyar', 'klungkung', 'karangasem', 'blahbatuh', 'sidemen', 'bali'],
    province: 'Bali',
  },
  // NTT
  { keys: ['soe', 'timor', 'kupang', 'nusa tenggara timur', 'ntt'], province: 'Nusa Tenggara Timur' },
  // NTB / Lombok
  { keys: ['lombok', 'mataram', 'cakranegara', 'praya', 'ntb'], province: 'Nusa Tenggara Barat' },
  // Kalbar
  { keys: ['pontianak', 'kalimantan barat', 'kalbar'], province: 'Kalimantan Barat' },
  // Kalsel / Kalteng
  {
    keys: ['banjarmasin', 'banjar', 'barito', 'katingan', 'kapuas', 'palangka', 'palangkaraya'],
    province: 'Kalimantan Selatan',
  },
  // Kaltim
  {
    keys: ['balikpapan', 'samarinda', 'tanah grogot', 'paser', 'kalimantan timur', 'kaltim'],
    province: 'Kalimantan Timur',
  },
  // Sulsel / Sulbar
  { keys: ['makassar', 'mamuju', 'sulawesi selatan', 'sulsel'], province: 'Sulawesi Selatan' },
  // Sulut dll
  { keys: ['manado', 'sulawesi utara'], province: 'Sulawesi Utara' },
];

function norm(s: string) {
  return (s || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * IDA-style identification: dari teks cabang/lokasi/kota → provinsi.
 */
export function identifyProvince(...parts: Array<string | null | undefined>): WilayahHit {
  const blob = norm(parts.filter(Boolean).join(' '));
  if (!blob) {
    return { province: 'Tidak diketahui', confidence: 'low', source: 'fallback' };
  }

  for (const rule of RULES) {
    for (const key of rule.keys) {
      if (blob === key) {
        return { province: rule.province, confidence: 'high', source: 'exact', matchedKey: key };
      }
    }
  }

  for (const rule of RULES) {
    for (const key of rule.keys) {
      if (blob.includes(key)) {
        return { province: rule.province, confidence: 'high', source: 'contains', matchedKey: key };
      }
    }
  }

  return { province: 'Tidak diketahui', confidence: 'low', source: 'fallback' };
}

/** Ringkas untuk work_locations: province + display name lokasi */
export function resolveWorkLocation(input: {
  lokasi?: string;
  cabang?: string;
  kotaUmk?: string;
  unitKerja?: string;
}) {
  const hit = identifyProvince(input.lokasi, input.cabang, input.kotaUmk, input.unitKerja);
  return {
    name: (input.lokasi || input.cabang || 'UNKNOWN').trim(),
    unit_kerja: input.unitKerja || null,
    province: hit.province,
    city_umk: input.kotaUmk || null,
    branch_name: input.cabang || null,
    identification: hit,
  };
}

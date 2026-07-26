/**
 * ProQPay Lite — Mapping Provinsi
 * Identifikasi provinsi dari cabang / lokasi / kota UMK (data HRIS IAP).
 * Dipakai IDA + import Excel sebelum insert work_locations.
 */

export type WilayahHit = {
  province: string;
  provinceCode: string | null;
  confidence: 'high' | 'medium' | 'low';
  source: 'exact' | 'contains' | 'fallback';
  matchedKey?: string;
};

export type ResolvedWorkLocation = {
  name: string;
  unit_kerja: string | null;
  province: string;
  provinceCode: string | null;
  city_umk: string | null;
  branch_name: string | null;
  identification: WilayahHit;
};

/** Kode Kemendagri singkat (umum dipakai) */
export const PROVINCE_CODES: Record<string, string> = {
  Aceh: '11',
  'Sumatera Utara': '12',
  'Sumatera Barat': '13',
  Riau: '14',
  Jambi: '15',
  'Sumatera Selatan': '16',
  Bengkulu: '17',
  Lampung: '18',
  'Kepulauan Bangka Belitung': '19',
  'Kepulauan Riau': '21',
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
  'Kalimantan Utara': '65',
  'Sulawesi Utara': '71',
  'Sulawesi Tengah': '72',
  'Sulawesi Selatan': '73',
  'Sulawesi Tenggara': '74',
  Gorontalo: '75',
  'Sulawesi Barat': '76',
  Maluku: '81',
  'Maluku Utara': '82',
  'Papua Barat': '92',
  Papua: '91',
};

/** Keyword → Provinsi (spesifik dulu) */
const RULES: Array<{ keys: string[]; province: string }> = [
  // Aceh
  {
    keys: [
      'banda aceh',
      'aceh besar',
      'takengon',
      'bireuen',
      'aceh jaya',
      'aceh tengah',
      'lampoh raja',
      'aceh',
    ],
    province: 'Aceh',
  },
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
      'binanga',
      'pulo bandring',
      'namohalu',
      'kolang',
      'hco medan',
      'medan amplas',
    ],
    province: 'Sumatera Utara',
  },
  // Sumbar
  { keys: ['padang', 'bukittinggi', 'sumatera barat', 'sumbar'], province: 'Sumatera Barat' },
  // Riau
  { keys: ['riau', 'pekanbaru', 'dumai'], province: 'Riau' },
  // Jambi
  { keys: ['jambi'], province: 'Jambi' },
  // Sumsel
  {
    keys: ['palembang', 'indralaya', 'gelumbang', 'ogan ilir', 'sumatera selatan', 'sumsel'],
    province: 'Sumatera Selatan',
  },
  // Bengkulu
  {
    keys: ['bengkulu', 'curup', 'rejang', 'lebong', 'seluma', 'kaur', 'gading cempaka'],
    province: 'Bengkulu',
  },
  // Lampung
  {
    keys: [
      'lampung',
      'bandar lampung',
      'natar',
      'terbanggi',
      'kalianda',
      'wayurang',
      'sukabumi lampung',
      'candi mas',
    ],
    province: 'Lampung',
  },
  // DKI / sekitar
  { keys: ['jakarta', 'dki'], province: 'DKI Jakarta' },
  { keys: ['tangerang', 'serang', 'cilegon', 'banten'], province: 'Banten' },
  // Jabar
  {
    keys: [
      'bandung',
      'tasikmalaya',
      'cirebon',
      'bogor',
      'karawang',
      'cihideung',
      'buahbatu',
      'jawa barat',
      'jabar',
      'hco bandung',
    ],
    province: 'Jawa Barat',
  },
  // Jateng
  {
    keys: [
      'semarang',
      'jepara',
      'batang',
      'limpung',
      'kudus',
      'nalumsari',
      'welahan',
      'jawa tengah',
      'jateng',
      'dc semarang',
    ],
    province: 'Jawa Tengah',
  },
  { keys: ['yogyakarta', 'sleman', 'bantul', 'diy'], province: 'DI Yogyakarta' },
  // Jatim
  {
    keys: [
      'malang',
      'jember',
      'banyuwangi',
      'surabaya',
      'gambiran',
      'genteng',
      'pesanggaran',
      'jawa timur',
      'jatim',
    ],
    province: 'Jawa Timur',
  },
  // Bali
  {
    keys: [
      'denpasar',
      'gianyar',
      'klungkung',
      'karangasem',
      'blahbatuh',
      'sidemen',
      'takmung',
      'sandubaya',
      'cakranegara',
      'bali',
    ],
    province: 'Bali',
  },
  // NTT
  { keys: ['soe', 'timor', 'kupang', 'nusa tenggara timur', 'ntt'], province: 'Nusa Tenggara Timur' },
  // NTB
  { keys: ['lombok', 'mataram', 'praya', 'nusa tenggara barat', 'ntb'], province: 'Nusa Tenggara Barat' },
  // Kalbar
  { keys: ['pontianak', 'kalimantan barat', 'kalbar'], province: 'Kalimantan Barat' },
  // Kalteng — sebelum Kalsel agar palangka tidak salah
  {
    keys: ['palangka', 'palangkaraya', 'kapuas', 'katingan', 'kalimantan tengah', 'kalteng'],
    province: 'Kalimantan Tengah',
  },
  // Kalsel
  {
    keys: ['banjarmasin', 'banjar', 'barito', 'tabunganen', 'kertak hanyar', 'kalimantan selatan', 'kalsel'],
    province: 'Kalimantan Selatan',
  },
  // Kaltim
  {
    keys: ['balikpapan', 'samarinda', 'tanah grogot', 'paser', 'kalimantan timur', 'kaltim'],
    province: 'Kalimantan Timur',
  },
  // Sulsel / Sulbar
  {
    keys: ['makassar', 'mamuju', 'sulawesi selatan', 'sulsel', 'sulawesi barat', 'sulbar'],
    province: 'Sulawesi Selatan',
  },
  { keys: ['manado', 'sulawesi utara', 'sulut'], province: 'Sulawesi Utara' },
  { keys: ['palu', 'sulawesi tengah', 'sulteng'], province: 'Sulawesi Tengah' },
  { keys: ['kendari', 'sulawesi tenggara', 'sultra'], province: 'Sulawesi Tenggara' },
  { keys: ['gorontalo'], province: 'Gorontalo' },
  { keys: ['ambon', 'maluku'], province: 'Maluku' },
  { keys: ['ternate', 'maluku utara'], province: 'Maluku Utara' },
  { keys: ['jayapura', 'papua'], province: 'Papua' },
  { keys: ['manokwari', 'papua barat'], province: 'Papua Barat' },
];

function norm(s: string) {
  return (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function withCode(province: string, rest: Omit<WilayahHit, 'province' | 'provinceCode'>): WilayahHit {
  return {
    province,
    provinceCode: PROVINCE_CODES[province] || null,
    ...rest,
  };
}

/**
 * Identifikasi provinsi dari satu atau banyak potongan teks.
 */
export function identifyProvince(...parts: Array<string | null | undefined>): WilayahHit {
  const blob = norm(parts.filter(Boolean).join(' '));
  if (!blob) {
    return withCode('Tidak diketahui', { confidence: 'low', source: 'fallback' });
  }

  // exact whole-string match on a key
  for (const rule of RULES) {
    for (const key of rule.keys) {
      if (blob === key) {
        return withCode(rule.province, {
          confidence: 'high',
          source: 'exact',
          matchedKey: key,
        });
      }
    }
  }

  // contains — longest key first for better specificity
  const flat = RULES.flatMap((r) => r.keys.map((k) => ({ key: k, province: r.province }))).sort(
    (a, b) => b.key.length - a.key.length
  );

  for (const { key, province } of flat) {
    if (blob.includes(key)) {
      return withCode(province, {
        confidence: key.length >= 5 ? 'high' : 'medium',
        source: 'contains',
        matchedKey: key,
      });
    }
  }

  return withCode('Tidak diketahui', { confidence: 'low', source: 'fallback' });
}

/**
 * Resolve record work_location siap insert DB.
 * Province selalu diisi hasil IDA mapping.
 */
export function resolveWorkLocation(input: {
  lokasi?: string | null;
  cabang?: string | null;
  kotaUmk?: string | null;
  unitKerja?: string | null;
}): ResolvedWorkLocation {
  const hit = identifyProvince(input.lokasi, input.cabang, input.kotaUmk, input.unitKerja);
  return {
    name: (input.lokasi || input.cabang || 'UNKNOWN').toString().trim(),
    unit_kerja: input.unitKerja ? String(input.unitKerja).trim() : null,
    province: hit.province,
    provinceCode: hit.provinceCode,
    city_umk: input.kotaUmk ? String(input.kotaUmk).trim() : null,
    branch_name: input.cabang ? String(input.cabang).trim() : null,
    identification: hit,
  };
}

/** Batch map untuk preview import */
export function mapRowsToProvinces(
  rows: Array<{ lokasi?: string; cabang?: string; kotaUmk?: string; unitKerja?: string }>
) {
  return rows.map((r) => resolveWorkLocation(r));
}

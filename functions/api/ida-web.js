/**
 * IDA restricted web knowledge lookup
 * - Only fires on explicit regulatory triggers
 * - Query narrowed with site: whitelist
 * - Only snippets with confidence >= 0.95 passed to model
 */

const CONFIDENCE_MIN = 0.95;

/** Official / high-trust domains only */
const ALLOWED_HOSTS = [
  'pajak.go.id',
  'kemenkeu.go.id',
  'bpjsketenagakerjaan.go.id',
  'bpjs-kesehatan.go.id',
  'kemnaker.go.id',
  'bps.go.id',
  'peraturan.bpk.go.id',
  'jdih.kemenkeu.go.id',
  'jdih.kemnaker.go.id',
  'djponline.pajak.go.id',
  'indonesia.go.id',
];

/**
 * Trigger positions: only when IDA needs external regulatory knowledge.
 * Each maps to a tight search query (not open-ended browsing).
 */
const TRIGGERS = [
  {
    id: 'pph21',
    test: /\b(pph\s*21|pph21|tarif\s*pajak|ter\s*pph|penghasilan\s*tidak\s*kena\s*pajak|ptkp)\b/i,
    query:
      'tarif PPh 21 TER terbaru site:pajak.go.id OR site:kemenkeu.go.id',
    label: 'PPh 21 / tarif pajak',
  },
  {
    id: 'bpjs_tk',
    test: /\b(bpjs\s*tk|bpjs\s*ketenagakerjaan|iuran\s*jht|jkk|jkm|jp\b|jaminan\s*hari\s*tua)\b/i,
    query:
      'iuran BPJS Ketenagakerjaan terbaru site:bpjsketenagakerjaan.go.id',
    label: 'BPJS Ketenagakerjaan',
  },
  {
    id: 'bpjs_kes',
    test: /\b(bpjs\s*kesehatan|iuran\s*jkn|bpjs\s*kes)\b/i,
    query: 'iuran BPJS Kesehatan terbaru site:bpjs-kesehatan.go.id',
    label: 'BPJS Kesehatan',
  },
  {
    id: 'umk',
    test: /\b(umr|umk|upah\s*minimum|ump\b)\b/i,
    query:
      'UMK UMP 2025 2026 disahkan site:kemnaker.go.id OR site:bps.go.id',
    label: 'UMR/UMK',
  },
  {
    id: 'peraturan_payroll',
    test: /\b(peraturan\s*menteri|pp\s*\d+|permenaker|ketentuan\s*baru\s*payroll)\b/i,
    query:
      'peraturan ketenagakerjaan pengupahan terbaru site:kemnaker.go.id OR site:peraturan.bpk.go.id',
    label: 'Peraturan pengupahan',
  },
];

function hostAllowed(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return ALLOWED_HOSTS.some((d) => host === d || host.endsWith('.' + d));
  } catch {
    return false;
  }
}

function matchTriggers(userText) {
  const hits = [];
  for (const t of TRIGGERS) {
    if (t.test.test(userText)) hits.push(t);
  }
  // hard cap: max 2 topics per turn (anti-meluas)
  return hits.slice(0, 2);
}

/**
 * DuckDuckGo Instant Answer + limited related topics
 * Restricted by site: operators in query string.
 */
async function searchDuckDuckGo(query) {
  const url =
    'https://api.duckduckgo.com/?format=json&no_html=1&skip_disambig=1&q=' +
    encodeURIComponent(query);

  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'ProQPayIDA/1.0' },
  });
  if (!res.ok) throw new Error(`DDG HTTP ${res.status}`);
  const data = await res.json();

  const items = [];

  if (data.AbstractText && data.AbstractURL) {
    items.push({
      title: data.Heading || 'Abstract',
      url: data.AbstractURL,
      snippet: data.AbstractText,
    });
  }

  const related = Array.isArray(data.RelatedTopics) ? data.RelatedTopics : [];
  for (const r of related) {
    if (r.Text && r.FirstURL) {
      items.push({ title: r.Text.slice(0, 80), url: r.FirstURL, snippet: r.Text });
    }
    if (Array.isArray(r.Topics)) {
      for (const t of r.Topics) {
        if (t.Text && t.FirstURL) {
          items.push({ title: t.Text.slice(0, 80), url: t.FirstURL, snippet: t.Text });
        }
      }
    }
  }

  // Official site pages sometimes appear in Results
  const results = Array.isArray(data.Results) ? data.Results : [];
  for (const r of results) {
    if (r.Text && r.FirstURL) {
      items.push({ title: r.Text.slice(0, 80), url: r.FirstURL, snippet: r.Text });
    }
  }

  return items.slice(0, 12);
}

/**
 * Confidence model (0–1):
 * - allowed host required else 0
 * - topic keyword overlap in snippet
 * - official path bonus (peraturan, tarif, iuran)
 */
function scoreConfidence(item, trigger) {
  if (!hostAllowed(item.url)) return 0;

  let score = 0.9; // base for whitelist host
  const blob = `${item.title} ${item.snippet}`.toLowerCase();

  const topicWords = trigger.label.toLowerCase().split(/\s+/);
  let hits = 0;
  for (const w of topicWords) {
    if (w.length > 2 && blob.includes(w)) hits++;
  }
  score += Math.min(0.05, hits * 0.015);

  if (/tarif|iuran|peraturan|ter\b|um[kp]|pph|bpjs/.test(blob)) score += 0.03;
  if (/2024|2025|2026/.test(blob)) score += 0.02;

  return Math.min(1, score);
}

/**
 * Main entry: returns only high-confidence web snippets for prompt injection.
 */
export async function fetchRegulatoryWeb(userText) {
  const triggers = matchTriggers(userText);
  if (!triggers.length) {
    return { used: false, triggers: [], snippets: [] };
  }

  const snippets = [];

  for (const trigger of triggers) {
    try {
      const raw = await searchDuckDuckGo(trigger.query);
      for (const item of raw) {
        const confidence = scoreConfidence(item, trigger);
        if (confidence >= CONFIDENCE_MIN) {
          snippets.push({
            topic: trigger.id,
            label: trigger.label,
            title: item.title,
            url: item.url,
            snippet: String(item.snippet || '').slice(0, 400),
            confidence: Number(confidence.toFixed(3)),
          });
        }
      }
    } catch {
      snippets.push({
        topic: trigger.id,
        label: trigger.label,
        title: 'web_search_error',
        url: '',
        snippet: `Pencarian ${trigger.label} sementara tidak tersedia.`,
        confidence: 0,
      });
    }
  }

  // keep only conf >= 95%, max 4 snippets total
  const accepted = snippets
    .filter((s) => s.confidence >= CONFIDENCE_MIN)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 4);

  return {
    used: accepted.length > 0,
    triggers: triggers.map((t) => t.id),
    snippets: accepted,
    rejectedBelowConfidence: snippets.filter((s) => s.confidence > 0 && s.confidence < CONFIDENCE_MIN).length,
    confidenceMin: CONFIDENCE_MIN,
  };
}

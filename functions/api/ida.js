/**
 * ProQPay Lite — IDA Gemini + RAG + memory + restricted web
 */
import { retrieveRag, loadMemory, saveMemory, loadFacts } from './ida-rag.js';
import { fetchRegulatoryWeb } from './ida-web.js';
import {
  ROLES,
  authorize,
  enforceRateLimit,
  handlePreflight,
  secureJson,
} from './_security.js';

const MODELS = ['gemini-3.5-flash', 'gemini-3.5-flash-lite'];
const METHODS = 'POST, OPTIONS';
const MAX_BODY_BYTES = 64 * 1024;
const MAX_MESSAGE_CHARS = 4000;
const KEY_NAMES = [
  'GEMINI_WORKER_1',
  'GEMINI_WORKER_2',
  'GEMINI_WORKER_3',
  'GEMINI_WORKER_4',
  'GEMINI_WORKER_5',
];

const SYSTEM_PROMPT = `Kamu adalah IDA, asisten payroll ProQPay Lite.

GAYA (sangat penting):
- Bahasa Indonesia kasual, ramah, natural seperti chat orang
- JANGAN mulai hampir setiap balasan dengan "Halo!" — sapaan hanya jika user menyapa dulu
- JANGAN menutup dengan ajakan upload Excel / tombol 📎 kecuali user memang tanya cara import/upload
- JANGAN mengulang penjelasan yang sama di setiap pesan (mis. "5% BPJS, 4% perusahaan, 1% karyawan") jika sudah dijelaskan di RECENT_CHAT — langsung jawab angka/poin baru yang diminta
- Jawaban 1–4 kalimat atau bullet singkat; lengkap, tidak terpotong
- Jika data di CLIENT_CONTEXT cukup, hitung/estimasi dari situ; jangan minta upload ulang

FAKTA OPERASIONAL:
- Dashboard read-only; upload file hanya via chat 📎 — sebutkan itu HANYA saat relevan
- Angka: pakai CLIENT_CONTEXT / RAG, jangan mengarang detail karyawan

Regulasi: pakai WEB_OFFICIAL bila ada (confidence ≥95%). Jika tidak ada, pakai pengetahuan standar singkat tanpa mengada-ada update tahun spesifik.`;

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'OPTIONS') {
    return handlePreflight(request, env, METHODS);
  }
  if (request.method !== 'POST') {
    return secureJson({ error: 'POST only' }, 405, request, env, METHODS);
  }

  const authorization = await authorize(request, env, {
    roles: ROLES,
    mutating: true,
    methods: METHODS,
  });
  if (authorization.response) return authorization.response;

  const rateLimited = await enforceRateLimit(
    request,
    env,
    authorization.actor,
    'ida-chat',
    METHODS
  );
  if (rateLimited) return rateLimited;

  const respond = (data, status = 200) =>
    secureJson(data, status, request, env, METHODS);
  const requestId = crypto.randomUUID();
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > MAX_BODY_BYTES) {
    return respond({ error: 'Payload too large' }, 413);
  }

  let body;
  try {
    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
      return respond({ error: 'Payload too large' }, 413);
    }
    body = JSON.parse(rawBody);
  } catch {
    return respond({ error: 'Invalid JSON' }, 400);
  }

  const userText = (body.message || body.text || '').trim();
  if (!userText) return respond({ error: 'message required' }, 400);
  if (userText.length > MAX_MESSAGE_CHARS) {
    return respond({ error: `message maksimal ${MAX_MESSAGE_CHARS} karakter` }, 422);
  }

  const rawSessionId = String(body.sessionId || body.session_id || 'default').slice(0, 80);
  const sessionId = `${authorization.actor.id}:${rawSessionId}`.slice(0, 120);

  const [ragChunks, history, facts, web] = await Promise.all([
    retrieveRag(env, userText, 8),
    loadMemory(env, sessionId, 10),
    loadFacts(env, sessionId, 6),
    fetchRegulatoryWeb(userText),
  ]);

  await saveMemory(env, sessionId, 'user', userText);

  const ragBlock = ragChunks.map((c, i) => `[${i + 1}:${c.source}/${c.id || '-'}] ${c.text}`).join('\n');
  const histBlock = history.map((h) => `${h.role}: ${h.content}`).join('\n').slice(0, 2800);
  const factBlock = facts.length ? facts.map((f, i) => `${i + 1}. ${f}`).join('\n') : '(belum ada)';
  const clientCtx = body.context
    ? `CLIENT_CONTEXT: ${JSON.stringify(body.context).slice(0, 1400)}`
    : '';

  let webBlock = '(tidak dipicu)';
  if (web.used && web.snippets?.length) {
    webBlock = web.snippets
      .map(
        (s, i) =>
          `[W${i + 1}|${s.topic}|conf=${s.confidence}] ${s.label}\n${s.snippet}\nSumber: ${s.url}`
      )
      .join('\n\n');
  }

  const prompt = `${SYSTEM_PROMPT}

RAG_CONTEXT:
${ragBlock || '(kosong)'}

WEB_OFFICIAL:
${webBlock}

LONG_MEMORY_FACTS:
${factBlock}

RECENT_CHAT (jangan mengulang poin yang sudah ada di sini):
${histBlock || '(baru)'}

${clientCtx}

User: ${userText}

Balas natural, tanpa "Halo!" rutin, tanpa CTA upload kecuali diminta.`;

  const keys = KEY_NAMES.map((n) => env[n]).filter(Boolean);
  if (!keys.length) {
    console.error(JSON.stringify({ level: 'error', requestId, event: 'ida_keys_unavailable' }));
    return respond({ error: 'AI service unavailable', requestId }, 503);
  }

  for (let ki = 0; ki < keys.length; ki++) {
    for (const model of MODELS) {
      try {
        const text = await callGemini(keys[ki], model, prompt);
        await saveMemory(env, sessionId, 'ida', text);
        const cotLines = [];
        if (ragChunks.length) cotLines.push(`RAG ${ragChunks.length} chunk`);
        if (web.triggers?.length) cotLines.push(`Web: ${web.triggers.join(',')}`);
        if (history.length) cotLines.push(`Memory ${history.length} turns`);
        if (model) cotLines.push(model);
        return respond({
          ok: true,
          reply: text,
          model,
          cot: {
            lines: cotLines,
            ragSources: ragChunks.map((c) => c.source + (c.id ? `/${c.id}` : '')),
            webTriggers: web.triggers || [],
            webUsed: !!web.used,
            memoryTurns: history.length,
            facts: facts.length,
          },
        });
      } catch (err) {
        const msg = err?.message || String(err);
        console.warn(
          JSON.stringify({
            level: 'warn',
            requestId,
            event: 'ida_provider_attempt_failed',
            model,
            keySlot: ki + 1,
            message: msg.slice(0, 200),
          })
        );
      }
    }
  }

  return respond({ ok: false, error: 'AI service unavailable', requestId }, 502);
}

async function callGemini(apiKey, model, prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.35, maxOutputTokens: 900 },
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error?.message || data?.error?.status || `HTTP ${res.status}`);
  }
  const text =
    data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') ||
    data?.candidates?.[0]?.content?.parts?.[0]?.text ||
    '';
  if (!text.trim()) throw new Error('Empty Gemini response');
  return text.trim();
}

/**
 * ProQPay Lite — IDA Gemini + RAG + long memory
 * Secrets: GEMINI_WORKER_1..5
 */
import { retrieveRag, loadMemory, saveMemory, loadFacts } from './ida-rag.js';

const MODELS = ['gemini-3.5-flash', 'gemini-3.5-flash-lite'];
const KEY_NAMES = [
  'GEMINI_WORKER_1',
  'GEMINI_WORKER_2',
  'GEMINI_WORKER_3',
  'GEMINI_WORKER_4',
  'GEMINI_WORKER_5',
];

const SYSTEM_PROMPT = `Kamu adalah IDA, asisten payroll ProQPay Lite.

Gaya: Bahasa Indonesia, kasual, ramah, sopan, singkat. Markdown OK.

Gunakan RAG_CONTEXT dan MEMORY sebagai sumber kebenaran. Jangan mengarang angka.
Kalau data ada di konteks, jawab langsung. Jangan mutar-mutar.
Jangan hitung payroll ulang kecuali user eksplisit minta.
Kalau user bilang "ingat ...", anggap itu preferensi jangka panjang.

Topik: payroll, BPJS, PPh, UMR, karyawan, client, invoice, AR, margin, import Excel, provinsi.`;

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors() });
  }
  if (request.method !== 'POST') return json({ error: 'POST only' }, 405);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const userText = (body.message || body.text || '').trim();
  if (!userText) return json({ error: 'message required' }, 400);

  const sessionId = String(body.sessionId || body.session_id || 'default').slice(0, 80);

  // RAG + memory (parallel)
  const [ragChunks, history, facts] = await Promise.all([
    retrieveRag(env, userText, 8),
    loadMemory(env, sessionId, 10),
    loadFacts(env, sessionId, 6),
  ]);

  await saveMemory(env, sessionId, 'user', userText);

  const ragBlock = ragChunks.map((c, i) => `[${i + 1}:${c.source}/${c.id || '-'}] ${c.text}`).join('\n');
  const histBlock = history.map((h) => `${h.role}: ${h.content}`).join('\n').slice(0, 2500);
  const factBlock = facts.length ? facts.map((f, i) => `${i + 1}. ${f}`).join('\n') : '(belum ada)';
  const clientCtx = body.context
    ? `CLIENT_CONTEXT: ${JSON.stringify(body.context).slice(0, 1000)}`
    : '';

  const prompt = `${SYSTEM_PROMPT}

RAG_CONTEXT:
${ragBlock || '(kosong)'}

LONG_MEMORY_FACTS:
${factBlock}

RECENT_CHAT:
${histBlock || '(baru)'}

${clientCtx}

User: ${userText}`;

  const keys = KEY_NAMES.map((n) => env[n]).filter(Boolean);
  if (!keys.length) {
    return json({ error: 'No Gemini keys', hint: 'Set GEMINI_WORKER_1..5' }, 500);
  }

  const attempts = [];
  let lastError = null;

  for (let ki = 0; ki < keys.length; ki++) {
    for (const model of MODELS) {
      try {
        const text = await callGemini(keys[ki], model, prompt);
        await saveMemory(env, sessionId, 'ida', text);
        return json({
          ok: true,
          reply: text,
          model,
          keyIndex: ki + 1,
          rag: ragChunks.map((c) => ({ source: c.source, id: c.id })),
          memoryTurns: history.length,
          attempts,
        });
      } catch (err) {
        const msg = err?.message || String(err);
        attempts.push({ keyIndex: ki + 1, model, error: msg.slice(0, 200) });
        lastError = msg;
      }
    }
  }

  return json({ ok: false, error: 'All Gemini failed', lastError, attempts }, 502);
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

function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors() },
  });
}

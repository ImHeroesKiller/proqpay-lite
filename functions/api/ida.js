/**
 * ProQPay Lite — IDA Gemini + RAG + memory + restricted web
 */
import { retrieveRag, loadMemory, saveMemory, loadFacts } from './ida-rag.js';
import { fetchRegulatoryWeb } from './ida-web.js';

const MODELS = ['gemini-3.5-flash', 'gemini-3.5-flash-lite'];
const KEY_NAMES = [
  'GEMINI_WORKER_1',
  'GEMINI_WORKER_2',
  'GEMINI_WORKER_3',
  'GEMINI_WORKER_4',
  'GEMINI_WORKER_5',
];

const SYSTEM_PROMPT = `Kamu adalah IDA, asisten payroll ProQPay Lite.

GAYA WAJIB:
- Bahasa Indonesia, kasual, ramah, sopan
- Jawaban LENGKAP dalam 2–6 kalimat atau bullet singkat
- JANGAN memotong kalimat di tengah
- JANGAN membuka dengan "Siap! Kita proses…" lalu berhenti — kalau akan aksi, sebut hasilnya langsung
- Jangan mutar-mutar minta konfirmasi berulang jika data sudah ada di konteks

UPLOAD FILE:
- Upload Excel HANYA lewat tombol 📎 di chat IDA
- JANGAN pernah bilang upload di dashboard (dashboard read-only)

INVOICE / PAYROLL:
- Jika user bilang generate/buat/kirim invoice dan client+periode sudah jelas di konteks, jawab seolah aksi lokal akan jalan; jangan tanya ulang client yang sudah disebut
- Jangan pakai angka mengarang; pakai CLIENT_CONTEXT

Gunakan RAG_CONTEXT, WEB_OFFICIAL (≥95%), MEMORY. Jangan mengarang regulasi.`;

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

  const [ragChunks, history, facts, web] = await Promise.all([
    retrieveRag(env, userText, 8),
    loadMemory(env, sessionId, 10),
    loadFacts(env, sessionId, 6),
    fetchRegulatoryWeb(userText),
  ]);

  await saveMemory(env, sessionId, 'user', userText);

  const ragBlock = ragChunks.map((c, i) => `[${i + 1}:${c.source}/${c.id || '-'}] ${c.text}`).join('\n');
  const histBlock = history.map((h) => `${h.role}: ${h.content}`).join('\n').slice(0, 2500);
  const factBlock = facts.length ? facts.map((f, i) => `${i + 1}. ${f}`).join('\n') : '(belum ada)';
  const clientCtx = body.context
    ? `CLIENT_CONTEXT: ${JSON.stringify(body.context).slice(0, 1200)}`
    : '';

  let webBlock = '(tidak dipicu / tidak ada hasil ≥95%)';
  if (web.used && web.snippets?.length) {
    webBlock = web.snippets
      .map(
        (s, i) =>
          `[W${i + 1}|${s.topic}|conf=${s.confidence}] ${s.label}\n${s.title}\n${s.snippet}\nSumber: ${s.url}`
      )
      .join('\n\n');
  } else if (web.triggers?.length) {
    webBlock = `(trigger: ${web.triggers.join(', ')} — tidak ada sumber resmi lolos confidence ${web.confidenceMin})`;
  }

  const prompt = `${SYSTEM_PROMPT}

RAG_CONTEXT:
${ragBlock || '(kosong)'}

WEB_OFFICIAL:
${webBlock}

LONG_MEMORY_FACTS:
${factBlock}

RECENT_CHAT:
${histBlock || '(baru)'}

${clientCtx}

User: ${userText}

Jawab lengkap, jangan terpotong.`;

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
          cot: {
            ragSources: ragChunks.map((c) => c.source + (c.id ? `/${c.id}` : '')),
            webTriggers: web.triggers || [],
            webUsed: !!web.used,
            memoryTurns: history.length,
            facts: facts.length,
          },
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
      generationConfig: {
        temperature: 0.25,
        maxOutputTokens: 1200,
        // discourage mid-sentence stop
      },
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

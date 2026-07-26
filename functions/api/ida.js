/**
 * ProQPay Lite — IDA Gemini proxy (Cloudflare Pages Function)
 *
 * Secrets: GEMINI_WORKER_1 ... GEMINI_WORKER_5
 * Fallback: each key → gemini-3.5-flash → gemini-3.5-flash-lite → next key
 */

const MODELS = ['gemini-3.5-flash', 'gemini-3.5-flash-lite'];
const KEY_NAMES = [
  'GEMINI_WORKER_1',
  'GEMINI_WORKER_2',
  'GEMINI_WORKER_3',
  'GEMINI_WORKER_4',
  'GEMINI_WORKER_5',
];

const SYSTEM_PROMPT = `Kamu adalah IDA, asisten payroll di ProQPay Lite.

Gaya bicara:
- Bahasa Indonesia, kasual tapi sopan
- Singkat dan to the point (1–4 kalimat, kecuali diminta detail)
- Ramah, ringan, tidak kaku
- Boleh pakai markdown sederhana: **tebal**, list, \\'kode\\'
- Jangan bertele-tele, jangan formal berlebihan

Topik: payroll, BPJS, PPh 21, UMR, karyawan, client, invoice, AR, approval, payment.

Kalau user minta aksi sistem, tetap jawab singkat dulu, lalu di baris paling akhir (opsional) tulis JSON saja:
{"intent":"nama_intent","period":null}
Intent: greeting, help, summary, list_employees, list_clients, calculate_payroll, approve_payroll, payment_instruction, outstanding, umr_check, unknown.`;

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors() });
  }

  if (request.method !== 'POST') {
    return json({ error: 'POST only' }, 405);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const userText = (body.message || body.text || '').trim();
  if (!userText) return json({ error: 'message required' }, 400);

  const contextHint = body.context
    ? `\nKonteks ringkas: ${JSON.stringify(body.context).slice(0, 600)}`
    : '';

  const prompt = `${SYSTEM_PROMPT}${contextHint}\n\nUser: ${userText}`;

  const keys = KEY_NAMES.map((name) => env[name]).filter(Boolean);
  if (!keys.length) {
    return json(
      {
        error: 'No Gemini keys configured',
        hint: 'Set GEMINI_WORKER_1..5 as secrets in Cloudflare Pages',
      },
      500
    );
  }

  const attempts = [];
  let lastError = null;

  for (let ki = 0; ki < keys.length; ki++) {
    const apiKey = keys[ki];
    for (const model of MODELS) {
      try {
        const text = await callGemini(apiKey, model, prompt);
        return json({
          ok: true,
          reply: text,
          model,
          keyIndex: ki + 1,
          attempts,
        });
      } catch (err) {
        const msg = err?.message || String(err);
        attempts.push({ keyIndex: ki + 1, model, error: msg.slice(0, 200) });
        lastError = msg;
      }
    }
  }

  return json(
    {
      ok: false,
      error: 'All Gemini keys/models failed',
      lastError,
      attempts,
    },
    502
  );
}

async function callGemini(apiKey, model, prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.55,
        maxOutputTokens: 800,
      },
    }),
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const errMsg =
      data?.error?.message ||
      data?.error?.status ||
      `HTTP ${res.status}`;
    throw new Error(errMsg);
  }

  const text =
    data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') ||
    data?.candidates?.[0]?.content?.parts?.[0]?.text ||
    '';

  if (!text.trim()) {
    throw new Error('Empty Gemini response');
  }

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

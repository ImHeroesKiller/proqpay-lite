/**
 * Gemini API helper for ProQPay Lite / IDA
 * Uses Google Generative Language API (REST)
 *
 * Set GEMINI_API_KEY in .env.local
 * Get key: https://aistudio.google.com/apikey
 */

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

export async function generateWithGemini(
  prompt: string,
  options?: {
    model?: string;
    temperature?: number;
    maxTokens?: number;
  }
): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error(
      'GEMINI_API_KEY is not set. Copy .env.example to .env.local and add your key from https://aistudio.google.com/apikey'
    );
  }

  const model = options?.model || process.env.GEMINI_MODEL || 'gemini-2.0-flash';
  const url = `${GEMINI_API_BASE}/models/${model}:generateContent?key=${apiKey}`;

  const body = {
    contents: [
      {
        parts: [{ text: prompt }],
      },
    ],
    generationConfig: {
      temperature: options?.temperature ?? 0.4,
      maxOutputTokens: options?.maxTokens ?? 1024,
    },
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini API error ${res.status}: ${errText}`);
  }

  const data = await res.json();
  const text =
    data?.candidates?.[0]?.content?.parts?.[0]?.text ||
    data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('') ||
    '';

  if (!text) {
    throw new Error('Gemini returned empty response');
  }

  return text.trim();
}

/**
 * Classify payroll intent using Gemini (for IDA)
 */
export async function classifyIntentWithGemini(
  userText: string,
  context?: { lastIntent?: string; currentPeriod?: string }
): Promise<{ intent: string; confidence: number; period?: string | null; note?: string }> {
  const prompt = `Anda adalah sistem klasifikasi intent untuk aplikasi payroll Indonesia bernama ProQPay.

Tugas: Tentukan intent dari pesan user.

Konteks: Intent sebelumnya: ${context?.lastIntent || 'tidak ada'}. Periode aktif: ${context?.currentPeriod || '2025-07'}.

Daftar intent yang valid:
- greeting, help, summary, payroll_status
- calculate_payroll, list_employees, list_clients
- ar_monitor, umr_check, billing
- unknown

Pesan user: "${userText}"

Balas HANYA dengan JSON valid (tanpa markdown):
{"intent":"nama_intent","confidence":0.0-1.0,"period":"YYYY-MM atau null","note":"catatan singkat"}`;

  try {
    const raw = await generateWithGemini(prompt, { temperature: 0.2, maxTokens: 256 });
    // Extract JSON even if wrapped in markdown
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return { intent: 'unknown', confidence: 0.3 };
    const parsed = JSON.parse(match[0]);
    return {
      intent: parsed.intent || 'unknown',
      confidence: parsed.confidence ?? 0.5,
      period: parsed.period ?? null,
      note: parsed.note,
    };
  } catch (e) {
    console.error('Gemini classify error:', e);
    return { intent: 'unknown', confidence: 0.2 };
  }
}

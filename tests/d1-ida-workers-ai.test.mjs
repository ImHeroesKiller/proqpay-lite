import assert from 'node:assert/strict';
import test from 'node:test';
import { onRequest as ida } from '../functions/api/ida.js';
import { D1Mock } from './helpers/d1-mock.mjs';

const origin = 'https://proqpay.test';
const request = (body) => new Request(`${origin}/api/ida`, {
  method: 'POST',
  headers: {
    Origin: origin,
    'Sec-Fetch-Site': 'same-origin',
    'Content-Type': 'application/json',
  },
  body: JSON.stringify(body),
});

test('IDA uses Workers AI and persists conversation in D1', async () => {
  const DB = new D1Mock();
  const calls = [];
  const env = {
    DB,
    WORKERS_AI_MODEL: '@cf/test/native-payroll-model',
    AI: {
      async run(model, input) {
        calls.push({ model, input });
        return { response: 'Ada 0 karyawan pada snapshot D1 saat ini.' };
      },
    },
  };

  const response = await ida({
    request: request({ message: 'Berapa jumlah karyawan?', sessionId: 'uat-native' }),
    env,
  });
  const payload = await response.json();
  assert.equal(response.status, 200, JSON.stringify(payload));
  assert.equal(payload.ok, true);
  assert.equal(payload.model, '@cf/test/native-payroll-model');
  assert.equal(payload.fallbackUsed, false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].model, '@cf/test/native-payroll-model');
  assert.match(calls[0].input.messages[1].content, /Snapshot D1/);
  assert.doesNotMatch(calls[0].input.messages[1].content, /Kamu adalah IDA/);
  assert.match(calls[0].input.messages[1].content, /RAG_CONTEXT_UNTRUSTED_DATA/);

  const rows = DB.sqlite.prepare(
    'SELECT role,content FROM ida_messages ORDER BY created_at,id'
  ).all();
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((row) => row.role).sort(), ['ida', 'user']);
});

test('IDA fails over to a second Cloudflare Workers AI model', async () => {
  const calls = [];
  const env = {
    DB: new D1Mock(),
    WORKERS_AI_MODEL: '@cf/test/primary',
    WORKERS_AI_FALLBACK_MODEL: '@cf/test/fallback',
    AI: {
      async run(model) {
        calls.push(model);
        if (model === '@cf/test/primary') throw new Error('primary unavailable');
        return { response: 'Layanan IDA tersedia melalui model cadangan.' };
      },
    },
  };

  const response = await ida({
    request: request({ message: 'Status payroll?', sessionId: 'uat-failover' }),
    env,
  });
  const payload = await response.json();
  assert.equal(response.status, 200, JSON.stringify(payload));
  assert.deepEqual(calls, ['@cf/test/primary', '@cf/test/fallback']);
  assert.equal(payload.model, '@cf/test/fallback');
  assert.equal(payload.fallbackUsed, true);
});

test('IDA fails closed when Workers AI binding is absent', async () => {
  const response = await ida({
    request: request({ message: 'Status payroll?' }),
    env: { DB: new D1Mock() },
  });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, 'AI service unavailable');
});

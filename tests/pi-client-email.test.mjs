import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
test('PI client confirmation is a separate email action with attachment-aware fallback', async () => {
  const [workspace, backend] = await Promise.all([
    readFile(new URL('src/components/OperatingWorkspace.tsx', root), 'utf8'),
    readFile(new URL('functions/api/operating-model-d1.js', root), 'utf8'),
  ]);
  assert.match(workspace, /Kirim ke klien/);
  assert.match(workspace, /navigator\.canShare/);
  assert.match(workspace, /files:\[file\]/);
  assert.match(workspace, /mailto:/);
  assert.match(workspace, /PDF .* sudah diunduh/);
  assert.match(workspace, /detail\.paymentInstruction\.status==='PAYMENT_APPROVAL_PENDING'/);
  assert.match(backend, /AS client_email/);
  assert.match(backend, /c\.billing_email,c\.contact_email/);
});

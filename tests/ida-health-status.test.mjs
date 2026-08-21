import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('IDA recognizes the native Cloudflare D1 health response', async () => {
  const source = await readFile(new URL('../src/components/IdaFab.tsx', import.meta.url), 'utf8');
  assert.match(source, /\['d1', 'connected'\]\.includes/);
  assert.doesNotMatch(
    source,
    /result\?\.database === 'connected' \? 'online' : 'degraded'/,
  );
});

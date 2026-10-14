import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const notice=readFileSync(new URL('../src/components/ui/UnifiedSystem.tsx',import.meta.url),'utf8');
test('information and notification bubbles can be closed from shared UI',()=>{
  assert.match(notice,/dismissible = true/);
  assert.match(notice,/aria-label="Tutup notifikasi"/);
  assert.match(notice,/setDismissed\(true\)/);
  assert.match(notice,/if \(dismissed\) return null/);
  assert.match(notice,/onDismiss\?\.\(\)/);
});

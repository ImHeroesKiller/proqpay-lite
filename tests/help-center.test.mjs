import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
test('header help opens a complete accessible help center', async () => {
  const [source, styles] = await Promise.all([readFile(new URL('src/components/HelpModal.tsx', root), 'utf8'), readFile(new URL('src/app/globals.css', root), 'utf8')]);
  for (const label of ['Workflow', 'User guide', 'Daftar istilah', 'FAQ', 'Bugs & kendala']) assert.match(source, new RegExp(label));
  assert.match(source, /role="dialog"/);
  assert.match(source, /aria-modal="true"/);
  assert.match(source, /event\.key === 'Escape'/);
  assert.match(source, /Maker–Checker/);
  assert.match(styles, /\.help-window/);
  assert.match(styles, /@media\(max-width:760px\)/);
});

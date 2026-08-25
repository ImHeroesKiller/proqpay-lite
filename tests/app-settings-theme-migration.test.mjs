import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const settings = readFileSync('src/lib/app-settings.ts', 'utf8');

test('legacy production accent migrates once to ProQPay brand', () => {
  assert.match(settings, /BRAND_ACCENT_MIGRATION_KEY/);
  assert.match(settings, /accentColor: ["']brand["'] as const/);
  assert.match(settings, /localStorage\.setItem\(BRAND_ACCENT_MIGRATION_KEY, ["']1["']\)/);
});

test('saved accent remains user-selectable after migration', () => {
  assert.match(settings, /if \(!localStorage\.getItem\(BRAND_ACCENT_MIGRATION_KEY\)\)/);
  assert.match(settings, /return stored/);
});

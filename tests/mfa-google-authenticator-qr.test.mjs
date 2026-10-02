import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('Google Authenticator enrollment renders QR locally without external QR service',async()=>{
  const [view,helper,vendor]=await Promise.all([
    readFile(new URL('../src/components/AuthViews.tsx',import.meta.url),'utf8'),
    readFile(new URL('../src/lib/totp-qr.ts',import.meta.url),'utf8'),
    readFile(new URL('../src/lib/vendor/qrcode.mjs',import.meta.url),'utf8'),
  ]);
  assert.match(view,/QR Code setup Google Authenticator/);
  assert.match(view,/createTotpQrDataUrl/);
  assert.match(helper,/qrcode\(0,'M'\)/);
  assert.match(helper,/createDataURL\(6,24\)/);
  assert.match(vendor,/QR Code Generator for JavaScript/);
  assert.doesNotMatch(view,/chart\.googleapis|quickchart|api\.qrserver|qrserver\.com/);
  assert.doesNotMatch(helper,/fetch\(|https?:\/\//);
});

test('manual setup key remains available as fallback',async()=>{
  const view=await readFile(new URL('../src/components/AuthViews.tsx',import.meta.url),'utf8');
  assert.match(view,/setup key manual/);
  assert.match(view,/Salin setup key/);
  assert.match(view,/Buka di Authenticator/);
});

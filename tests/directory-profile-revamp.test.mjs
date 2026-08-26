import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);

test('client and project directory supports scalable discovery and paging', async () => {
  const source = await readFile(new URL('src/components/DirectoryManager.tsx', root), 'utf8');

  assert.match(source, /placeholder="Cari klien, kode, project, layanan/);
  assert.match(source, /aria-label="Filter status"/);
  assert.match(source, /aria-label="Filter project berdasarkan klien"/);
  assert.match(source, /pageSize = 8/);
  assert.match(source, /function DirectoryPager/);
  assert.match(source, /clientId: selectedClientId === 'ALL'/);
});

test('account profile presents a structured identity card with a cropped photo', async () => {
  const [header, styles] = await Promise.all([
    readFile(new URL('src/components/AppHeader.tsx', root), 'utf8'),
    readFile(new URL('src/app/globals.css', root), 'utf8'),
  ]);

  assert.match(header, /profile-card-cover/);
  assert.match(header, /profile-identity/);
  assert.match(header, /profile-details/);
  assert.match(styles, /\.profile-card-cover/);
  assert.match(styles, /\.header-account>button>i\{overflow:hidden;border-radius:50%\}/);
  assert.match(styles, /object-fit:cover/);
});

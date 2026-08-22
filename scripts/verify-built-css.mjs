import { readdir, readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(process.argv[2] || 'out');

async function cssFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...await cssFiles(path));
    else if (entry.isFile() && entry.name.endsWith('.css')) files.push(path);
  }
  return files;
}

const files = await cssFiles(root);
if (!files.length) throw new Error('Build tidak menghasilkan stylesheet CSS.');

const contents = await Promise.all(files.map((file) => readFile(file, 'utf8')));
const combined = contents.join('\n');
const bytes = (await Promise.all(files.map((file) => stat(file)))).reduce((sum, item) => sum + item.size, 0);

if (/unparsable[^\n]*globals\.css/i.test(combined)) {
  throw new Error('globals.css tidak dapat diparse tetapi build mencoba tetap melanjutkan.');
}
if (bytes < 30_000) throw new Error(`CSS build terlalu kecil (${bytes} byte); kemungkinan design system hilang.`);
for (const selector of ['.app-sidebar', '.operations-summary-grid', '.directory-modal']) {
  if (!combined.includes(selector)) throw new Error(`Selector kritis hilang dari CSS build: ${selector}`);
}

console.log(`CSS build verified: ${files.length} file, ${bytes} byte.`);

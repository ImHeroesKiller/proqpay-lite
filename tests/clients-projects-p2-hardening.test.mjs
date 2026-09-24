import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read=(path)=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('Clients & Projects P2 exposes project truncation metadata',async()=>{
  const api=await read('functions/api/client-projects.js');
  assert.match(api,/LIMIT 501/);
  assert.match(api,/projectsTruncated = projectsRaw\.length > 500/);
  assert.match(api,/projectsRaw\.slice\(0, 500\)/);
  assert.match(api,/projectLimit: 500/);
});

test('Clients & Projects P2 supports search filters and local pagination',async()=>{
  const ui=await read('src/components/DirectoryManager.tsx');
  assert.match(ui,/const \[query,setQuery\]/);
  assert.match(ui,/const \[statusFilter,setStatusFilter\]/);
  assert.match(ui,/const \[projectClientFilter,setProjectClientFilter\]/);
  assert.match(ui,/const PAGE_SIZE=8/);
  assert.match(ui,/DirectoryPager page=\{clientPage\}/);
  assert.match(ui,/DirectoryPager page=\{projectPage\}/);
});

test('Clients & Projects P2 distinguishes success error and truncation notices',async()=>{
  const ui=await read('src/components/DirectoryManager.tsx');
  assert.match(ui,/messageTone/);
  assert.match(ui,/role=\{messageTone==='error'\?'alert':'status'\}/);
  assert.match(ui,/projectsTruncated/);
  assert.match(ui,/Daftar project dibatasi 500 record/);
});

test('Clients & Projects P2 modal supports escape focus trap restore and scroll lock',async()=>{
  const ui=await read('src/components/DirectoryManager.tsx');
  assert.match(ui,/document\.body\.style\.overflow='hidden'/);
  assert.match(ui,/event\.key==='Escape'/);
  assert.match(ui,/event\.key!=='Tab'/);
  assert.match(ui,/previousFocusRef\.current\?\.focus\(\)/);
  assert.match(ui,/dialogRef/);
  assert.match(ui,/detailDialogRef/);
});

test('Clients & Projects P2 has semantic status badges detail actions and transfer warning',async()=>{
  const ui=await read('src/components/DirectoryManager.tsx');
  assert.match(ui,/statusClass\(client\.status\)/);
  assert.match(ui,/statusClass\(project\.status\)/);
  assert.match(ui,/setDetail\(\{type:'client'/);
  assert.match(ui,/setDetail\(\{type:'project'/);
  assert.match(ui,/Project akan dipindahkan ke klien lain/);
  assert.match(ui,/DirectoryDetail/);
});

test('client logos use authenticated same-origin proxy',async()=>{
  const ui=await read('src/components/DirectoryManager.tsx');
  const proxy=await read('functions/api/client-logo.js');
  assert.match(ui,/\/api\/client-logo\?id=/);
  assert.doesNotMatch(ui,/src=\{client\.logo_url\}/);
  assert.match(proxy,/authorize\(request,env/);
  assert.match(proxy,/clientIdsFor\(actor,env\)/);
  assert.match(proxy,/redirect:'manual'/);
  assert.match(proxy,/contentType\.startsWith\('image\/'\)/);
  assert.match(proxy,/body\.byteLength>2_000_000/);
});

test('Clients & Projects P2 styles status and responsive directory controls',async()=>{
  const css=await read('src/app/polish.css');
  assert.match(css,/Clients & Projects P2/);
  assert.match(css,/\.directory-badge\.inactive/);
  assert.match(css,/\.directory-badge\.on-hold/);
  assert.match(css,/\.directory-badge\.completed/);
  assert.match(css,/\.directory-toolbar/);
  assert.match(css,/\.directory-detail-grid/);
  assert.match(css,/\.directory-transfer-warning/);
});

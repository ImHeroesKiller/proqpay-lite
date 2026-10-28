import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {orderedGlobalCss,globalFoundationCss,domainPolishCss,featureCss,accessibilityCss,originalLegacyHashes} from '../scripts/css-manifest.mjs';
import {createHash} from 'node:crypto';
const read=path=>readFile(new URL('../'+path,import.meta.url),'utf8');
const hash=data=>createHash('sha256').update(data).digest('hex');

test('G4 accessibility CSS is explicit final cascade module; G1 base signatures remain immutable',async()=>{
 assert.deepEqual(accessibilityCss,['src/app/styles/accessibility.css']);
 assert.equal(orderedGlobalCss.at(-1),accessibilityCss[0]);
 assert.deepEqual(orderedGlobalCss.slice(-featureCss.length-1,-1),featureCss);
 const [global,polish]=await Promise.all([
  Promise.all(globalFoundationCss.map(read)).then(p=>p.join('')),
  Promise.all(domainPolishCss.map(read)).then(p=>p.join('')),
 ]);
 assert.equal(hash(global),originalLegacyHashes.global);
 assert.equal(hash(polish),originalLegacyHashes.polish);
 const css=await read(accessibilityCss[0]);
 assert.match(css,/theme-dark/);
 assert.match(css,/sidebar-nav-active/);
 assert.doesNotMatch(css,/\b@layer\b|\b@import\b/);
});

test('G4 common Tabs support keyboard arrows, roving tabIndex and existing onChange contract',async()=>{
 const ui=await read('src/components/ui/UnifiedSystem.tsx');
 for(const key of ['ArrowLeft','ArrowRight','Home','End'])assert.ok(ui.includes(key),key);
 assert.match(ui,/tabIndex=\{value === item.value \? 0 : -1\}/);
 assert.match(ui,/onChange\(next.value\)/);
 assert.match(ui,/aria-selected=\{value === item.value\}/);
 assert.match(ui,/\?\.\[nextIndex\]\?\.focus\(\)/);
});

test('G4 semantic labels, headings, integration groups and table header retain accessible structure',async()=>{
 const [router,employee,payroll,activity,primitives,header]=await Promise.all([
  read('src/components/AppWorkspaceRouter.tsx'),read('src/components/EmployeeDirectory.tsx'),
  read('src/components/PayrollControlTower.tsx'),read('src/components/integrations/IntegrationActivity.tsx'),
  read('src/components/integrations/IntegrationPrimitives.tsx'),read('src/components/AppHeader.tsx'),
 ]);
 assert.match(router,/needsSemanticHeading/);
 assert.match(router,/<h1 className="visually-hidden">/);
 assert.match(employee,/<th scope="col"><span className="visually-hidden">Aksi<\/span><\/th>/);
 assert.match(payroll,/portfolio-snapshot" aria-label="Ringkasan kesiapan master data" tabIndex=\{0\}/);
 assert.match(activity,/integration-events-mobile" role="group"/);
 assert.match(primitives,/role="group" aria-label="Pagination aktivitas API"/);
 assert.match(header,/aria-label="Cari modul"/);
 assert.match(header,/<span>Cari modul<\/span>/);
});

test('G4 CI tests synthetic roles and WCAG; production tests do not attempt financial execution',async()=>{
 const [workflow,matrix,prod,theme]=await Promise.all([
  read('.github/workflows/g4-accessibility-gate.yml'),
  read('tests/e2e/g4-accessibility-matrix.spec.mjs'),
  read('tests/e2e/g4-production-readonly.spec.mjs'),
  read('tests/e2e/g4-theme-accessibility.spec.mjs'),
 ]);
 assert.match(workflow,/G4 Read-only Axe \/ Responsive/);
 assert.match(workflow,/npm ci/);
 assert.match(workflow,/axe-core@4\.12\.1/);
 assert.match(matrix,/WCAG\/contrast and responsive role matrix/);
 assert.match(matrix,/expect\(writes,'UAT never calls financial mutations'\)\.toBe\(0\)/);
 assert.match(prod,/request\.get/);
 assert.doesNotMatch(prod,/request\.(post|put|patch|delete)\(/);
 assert.match(theme,/reducedMotion:'reduce'/);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import postcss from 'postcss';
import {globalFoundationCss,domainPolishCss,featureCss,orderedGlobalCss,originalLegacyHashes} from '../scripts/css-manifest.mjs';
import {readGlobalCss,readPolishCss} from './helpers/style-sources.mjs';
const read=path=>readFile(new URL('../'+path,import.meta.url),'utf8');
const hash=text=>createHash('sha256').update(text).digest('hex');

test('G1 architectural split retains exact global + polish CSS cascade bytes and rule order',async()=>{
 const [globals,polish]=await Promise.all([readGlobalCss(),readPolishCss()]);
 assert.equal(hash(globals),originalLegacyHashes.global);
 assert.equal(hash(polish),originalLegacyHashes.polish);
 const globalRoot=postcss.parse(globals);const polishRoot=postcss.parse(polish);
 let r=0,d=0;globalRoot.walkRules(()=>r++);globalRoot.walkDecls(()=>d++);
 assert.equal(r,2127);assert.equal(d,7029);
 r=0;d=0;polishRoot.walkRules(()=>r++);polishRoot.walkDecls(()=>d++);
 assert.equal(r,653);assert.equal(d,2099);
});

test('G1 layout defines the exact modular cascade and keeps feature-specific CSS last',async()=>{
 const layout=await read('src/app/layout.tsx');
 const imports=[...layout.matchAll(/^import ["'](\.\/[\w./-]+\.css)["'];?$/gm)].map(m=>'src/app/'+m[1].slice(2));
 assert.deepEqual(imports,orderedGlobalCss);
 assert.equal(globalFoundationCss.length,6);
 assert.equal(domainPolishCss.length,7);
 assert.deepEqual(featureCss,['src/app/employee-services.css','src/app/audit-console.css','src/app/e2pay-wallet.css','src/app/styles/workspace-v2.css']);
 for(const [index,path] of orderedGlobalCss.entries()){
  assert.equal(imports[index],path);
  const css=await read(path);
  const ast=postcss.parse(css,{from:path});
  assert.ok(ast.nodes.length>0,path);
  assert.doesNotMatch(css,/^\s*@import\b/m,`${path}: hidden imports alter cascade`);
  assert.doesNotMatch(css,/@layer\s*(\{|[\w-])/,`${path}: layered rules alter cascade priority`);
 }
});

test('G1 base tokens are isolated, premium bridge and shell tokens remain in their original cascade positions',async()=>{
 const [tokens,legacy,premium,shell,shared,operations]=await Promise.all(globalFoundationCss.map(read));
 for(const k of ['--bg','--bg-surface','--border','--text','--accent','--focus-ring','--shadow-xs','--ui-control-height'])assert.match(tokens,new RegExp(k+':'));
 assert.match(tokens,/^:root \{/m);
 assert.doesNotMatch(legacy,/^:root \{/m);
 assert.match(premium,/^:root \{/m);
 assert.match(shell,/^:root \{/m);
 assert.match(legacy,/\.theme-dark/);
 assert.match(shared,/P1 Unified Component System/);
 for(const sel of ['.directory-entity-card','.ui-table-wrap','.ui-status-success','.ui-modal-backdrop'])assert.ok(shared.includes(sel)||legacy.includes(sel),sel);
 for(const sel of ['.payroll-stage-nav','.payment-decision-nav','.directory-filter-compact','.payment-instruction-table-flat'])assert.ok(operations.includes(sel),sel);
});

test('G1 legacy static CSS tests read the exact ordered assembler rather than a truncated source file',async()=>{
 const helper=await read('tests/helpers/style-sources.mjs');
 assert.match(helper,/globalFoundationCss/);
 assert.match(helper,/domainPolishCss/);
 const source=await read('src/app/globals.css');
 assert.doesNotMatch(source,/\/\* Unified payroll workspace \*\//);
 assert.match(source,/Database-backed account management/);
});

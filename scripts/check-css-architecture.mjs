#!/usr/bin/env node
/**
 * G1 architecture gate: validates physical order, original cascade signatures,
 * parser health, existing semantic tokens and guarded root variable ownership.
 * Existing pre-G1 CSS remains UNLAYERED to preserve matching/specificity.
 * A visual-approved CSS change can update hashes in css-manifest.mjs; imports
 * must still be reviewed in order; run the G1 Playwright smoke before approval.
 */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import postcss from 'postcss';
import {globalFoundationCss,domainPolishCss,featureCss,orderedGlobalCss,originalLegacyHashes} from './css-manifest.mjs';
const text=(await readFile('src/app/layout.tsx','utf8'));
const imports=[...text.matchAll(/^import\s+["'](\.\/[\w./-]+\.css)["'];?$/gm)].map(m=>'src/app/'+m[1].slice(2));
assert.deepEqual(imports,orderedGlobalCss,'G1 CSS import order changed: cascade review required');
const sources=await Promise.all(orderedGlobalCss.map(path=>readFile(path,'utf8')));
const cssSha=css=>createHash('sha256').update(css).digest('hex');
const globals=sources.slice(0,globalFoundationCss.length).join('');
const polish=sources.slice(globalFoundationCss.length,globalFoundationCss.length+domainPolishCss.length).join('');
assert.equal(cssSha(globals),originalLegacyHashes.global,'Legacy global cascade changed: update baseline ONLY after deliberate UI review');
assert.equal(cssSha(polish),originalLegacyHashes.polish,'Legacy polish cascade changed: update baseline ONLY after deliberate UI review');
let rules=0,declarations=0,important=0;
const namespaces=new Map();
for(const [i,path] of orderedGlobalCss.entries()){
 const css=sources[i];
 assert(!/@layer\s*(?:\{|[\w-])/.test(css),`${path}: @layer requires separate cascade migration`);
 assert(!/^\s*@import\b/m.test(css),`${path}: stylesheet must use explicit layout.tsx imports`);
 const parsed=postcss.parse(css,{from:path});
 parsed.walkRules(rule=>{
  rules++;
  const first=rule.selector?.split(',')[0]?.trim()||'';
  if(first && /^\.[\w-]+$/.test(first))namespaces.set(first,(namespaces.get(first)||0)+1);
 });
 parsed.walkDecls(decl=>{declarations++;if(decl.important)important++;});
}
const tokens=sources[0];
for(const variable of ['--app-font-sans','--bg','--bg-surface','--text','--text2','--text3','--border','--accent','--accent-hover','--focus-ring','--ui-control-height','--ui-density-row']){
 assert(new RegExp(variable.replaceAll('-','\\-')+'\\s*:').test(tokens),`Missing CSS foundation token: ${variable}`);
}
assert(/^\/\* ProQPay Lite/m.test(tokens),'Token foundation header missing');
assert(globals.includes('/* Unified application shell — Sidebar/Header/Footer system */'),'Missing shell module in original cascade');
assert(globals.includes('/* Unified payroll workspace */'),'Missing operational CSS in original cascade');
console.log(JSON.stringify({ok:true,architecture:'G1_UNLAYERED_COMPATIBILITY_CASCADE',globalModules:globalFoundationCss.length,polishModules:domainPolishCss.length,featureModules:featureCss.length,globalHash:cssSha(globals),polishHash:cssSha(polish),rules,declarations,important,bytes:sources.reduce((n,s)=>n+Buffer.byteLength(s),0)},null,2));

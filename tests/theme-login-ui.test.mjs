import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, statSync } from 'node:fs';

const css = readFileSync('src/app/globals.css','utf8');
const polish = readFileSync('src/app/polish.css','utf8');
const auth = readFileSync('src/components/AuthViews.tsx','utf8');

test('login page is professional, responsive, and uses a local optimized hero', () => {
  assert.match(auth, /Payroll Operations,/);
  assert.match(auth, /AI-assisted Data Readiness/);
  assert.match(auth, /login-payroll-team\.webp/);
  assert.match(auth, /showPassword/);
  assert.match(css, /\.login-shell/);
  assert.match(css, /@media\(max-width:820px\)/);
  assert.doesNotMatch(css, /login-brand-inverse img\{filter:/);
  assert.ok(statSync('public/assets/login-payroll-team.webp').size < 200_000);
});

test('accent tokens drive hover and pipeline colors without forced purple', () => {
  for (const token of ['--accent-hover','--accent-contrast','--surface-hover','--text-primary','--focus-ring']) assert.match(css,new RegExp(token));
  assert.doesNotMatch(polish,/linear-gradient\(90deg, #6366f1/);
  assert.match(polish,/background: linear-gradient\(90deg, var\(--accent\), var\(--accent2\)\)/);
  assert.match(css,/\.btn-primary:hover[\s\S]*?var\(--accent-contrast\)/);
  assert.match(polish,/\.btn\.btn-primary:hover[\s\S]*?background:[\s\S]*?!important/);
});

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { validateDirectoryAction } from '../functions/api/client-projects-validation.js';

const read=(path)=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('client-project mutations enforce explicit backend write permissions',async()=>{
  const source=await read('functions/api/client-projects.js');
  assert.match(source,/requiredPermission = action\.endsWith\('_CLIENT'\) \? 'client:write'/);
  assert.match(source,/action\.endsWith\('_PROJECT'\) \? 'project:write'/);
  assert.match(source,/!actor\.permissions\?\.includes\(requiredPermission\)/);
  assert.match(source,/Insufficient permission/);
});

test('client logo discovery validates every redirect instead of blindly following',async()=>{
  const source=await read('functions/api/client-projects.js');
  assert.match(source,/async function fetchSafe/);
  assert.match(source,/redirect: 'manual'/);
  assert.match(source,/\[301,302,303,307,308\]\.includes\(response\.status\)/);
  assert.match(source,/safeWebsite\(next\.toString\(\)\)/);
  assert.doesNotMatch(source,/redirect: 'follow'/);
});

test('directory validation rejects reversed project dates and invalid percentage rates',()=>{
  const reversed=validateDirectoryAction({
    action:'CREATE_PROJECT',name:'Project A',clientId:'CLI-A',
    startDate:'2026-10-02',endDate:'2026-10-01',
  });
  assert.equal(reversed.ok,false);
  assert.ok(reversed.errors.includes('periode project tidak valid'));

  const percent=validateDirectoryAction({
    action:'CREATE_CLIENT',name:'Client A',
    billingMethod:'PERCENTAGE_OF_PAYROLL',billingRate:101,
  });
  assert.equal(percent.ok,false);
  assert.ok(percent.errors.includes('rate persentase payroll tidak valid'));
});

test('Non-PKP tax rate is normalized to zero server-side',()=>{
  const result=validateDirectoryAction({
    action:'CREATE_CLIENT',name:'Client A',taxStatus:'NON_PKP',billingTaxRate:11,
  });
  assert.equal(result.ok,true);
  assert.equal(result.value.billingTaxRate,0);
});

test('directory fallback records deduplicate by canonical IDs, not names',async()=>{
  const source=await read('src/components/DirectoryManager.tsx');
  assert.match(source,/const clientIds = new Set\(clients\.map\(\(client\) => client\.id\)\)/);
  assert.match(source,/!clientIds\.has\(client\.id\)/);
  assert.match(source,/const projectIds = new Set\(projects\.map\(\(project\) => project\.id\)\)/);
  assert.match(source,/!projectIds\.has\(project\.id\)/);
  assert.doesNotMatch(source,/const projectNames = new Set/);
});

test('directory UI prevents invalid dates and clears tax when switching to Non-PKP',async()=>{
  const source=await read('src/components/DirectoryManager.tsx');
  assert.match(source,/billingTaxRate:event\.target\.value==='PKP'\?form\.billingTaxRate:'0'/);
  assert.match(source,/billingTaxRate:form\.taxStatus==='PKP'\?Number\(form\.billingTaxRate\):0/);
  assert.match(source,/max=\{form\.endDate\|\|undefined\}/);
  assert.match(source,/min=\{form\.startDate\|\|undefined\}/);
  assert.match(source,/max=\{form\.billingMethod==='PERCENTAGE_OF_PAYROLL'\?'100':undefined\}/);
});

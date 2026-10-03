import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const script=new URL('../scripts/security-audit-gate.mjs',import.meta.url);

async function runGate(report,lock){
  const dir=await mkdtemp(join(tmpdir(),'proqpay-audit-'));
  const audit=join(dir,'audit.json');
  const lockFile=join(dir,'package-lock.json');
  await Promise.all([
    writeFile(audit,JSON.stringify(report)),
    writeFile(lockFile,JSON.stringify(lock)),
  ]);
  return spawnSync(process.execPath,[script.pathname,audit,lockFile],{encoding:'utf8'});
}

test('security gate narrowly accepts GHSA-vfj7-8cjw-p6xm only when every affected node is dev-only',async()=>{
  const report={vulnerabilities:{
    braces:{severity:'high',via:[{url:'https://github.com/advisories/GHSA-vfj7-8cjw-p6xm'}],nodes:['node_modules/braces']},
    micromatch:{severity:'high',via:['braces'],nodes:['node_modules/micromatch']},
  }};
  const lock={packages:{'node_modules/braces':{dev:true},'node_modules/micromatch':{dev:true}}};
  const result=await runGate(report,lock);
  assert.equal(result.status,0,result.stderr);
  assert.match(result.stderr,/Temporarily accepted dev-only advisory chain/);
});

test('security gate still blocks any other High or Critical advisory',async()=>{
  const report={vulnerabilities:{
    example:{severity:'critical',via:[{url:'https://github.com/advisories/GHSA-other'}],nodes:['node_modules/example']},
  }};
  const lock={packages:{'node_modules/example':{dev:true}}};
  const result=await runGate(report,lock);
  assert.equal(result.status,1);
  assert.match(result.stderr,/Blocking High\/Critical/);
});

test('security gate does not waive the braces advisory when it reaches production dependencies',async()=>{
  const report={vulnerabilities:{
    braces:{severity:'high',via:[{url:'https://github.com/advisories/GHSA-vfj7-8cjw-p6xm'}],nodes:['node_modules/braces']},
  }};
  const lock={packages:{'node_modules/braces':{dev:false}}};
  const result=await runGate(report,lock);
  assert.equal(result.status,1);
});

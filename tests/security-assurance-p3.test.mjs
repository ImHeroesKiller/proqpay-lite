import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const assuranceScript=fileURLToPath(new URL('../scripts/security-assurance-gate.mjs',import.meta.url));
const zapScript=fileURLToPath(new URL('../scripts/security-zap-gate.mjs',import.meta.url));

async function setup(){
  const dir=await mkdtemp(path.join(tmpdir(),'proqpay-p3-'));
  return {
    dir,
    incidents:path.join(dir,'incidents.json'),
    audit:path.join(dir,'audit.json'),
    workflows:path.join(dir,'workflows.json'),
    pentest:path.join(dir,'pentest.json'),
    tabletop:path.join(dir,'tabletop.json'),
    evidence:path.join(dir,'evidence.json'),
  };
}

function isoOffset(days){
  return new Date(Date.now()+days*86_400_000).toISOString();
}

test('P3 final assurance gate passes only with current technical and independent evidence',async()=>{
  const x=await setup();
  await writeFile(x.incidents,JSON.stringify([{results:[]}]));
  await writeFile(x.audit,JSON.stringify({metadata:{vulnerabilities:{critical:0,high:0}}}));
  await writeFile(x.workflows,JSON.stringify({workflows:[
    {name:'Security Dependency & Vulnerability Scan',conclusion:'success',updatedAt:isoOffset(-0.2)},
    {name:'Security D1 Backup & Restore Drill',conclusion:'success',updatedAt:isoOffset(-0.2)},
    {name:'Security Audit Integrity Checkpoint',conclusion:'success',updatedAt:isoOffset(-0.2)},
    {name:'Production Security Uptime Monitor',conclusion:'success',updatedAt:isoOffset(-0.01)},
    {name:'Security DAST Baseline',conclusion:'success',updatedAt:isoOffset(-1)},
    {name:'Security Quarterly Restore Assurance',conclusion:'success',updatedAt:isoOffset(-30)},
    {name:'Cloudflare Pages Production Deploy',conclusion:'success',updatedAt:isoOffset(-1)},
  ]}));
  await writeFile(x.pentest,JSON.stringify({
    assessorType:'INDEPENDENT_THIRD_PARTY',
    reportDate:isoOffset(-10),
    validUntil:isoOffset(180),
    scope:['https://proqpay.msg-os.com'],
    methodology:'OWASP WSTG',
    criticalOpen:0,
    highOpen:0,
    reportSha256:'a'.repeat(64),
  }));
  await writeFile(x.tabletop,JSON.stringify({
    exerciseDate:isoOffset(-20),
    scenario:'Privileged identity anomaly and uncertain payroll payment',
    participantCount:2,
    actionsRecorded:true,
    evidenceSha256:'b'.repeat(64),
  }));
  const run=spawnSync(process.execPath,[assuranceScript,x.incidents,x.audit,x.workflows,x.pentest,x.tabletop,x.evidence],{encoding:'utf8'});
  assert.equal(run.status,0,run.stderr||run.stdout);
  const evidence=JSON.parse(await readFile(x.evidence,'utf8'));
  assert.equal(evidence.finalStatus,'PASS');
  assert.deepEqual(evidence.blockers,[]);
});

test('P3 final assurance gate refuses to self-certify missing pentest and tabletop',async()=>{
  const x=await setup();
  await writeFile(x.incidents,JSON.stringify([{results:[]}]));
  await writeFile(x.audit,JSON.stringify({metadata:{vulnerabilities:{critical:0,high:0}}}));
  await writeFile(x.workflows,JSON.stringify({workflows:[
    {name:'Security Dependency & Vulnerability Scan',conclusion:'success',updatedAt:isoOffset(-0.2)},
    {name:'Security D1 Backup & Restore Drill',conclusion:'success',updatedAt:isoOffset(-0.2)},
    {name:'Security Audit Integrity Checkpoint',conclusion:'success',updatedAt:isoOffset(-0.2)},
    {name:'Production Security Uptime Monitor',conclusion:'success',updatedAt:isoOffset(-0.01)},
    {name:'Security DAST Baseline',conclusion:'success',updatedAt:isoOffset(-1)},
    {name:'Security Quarterly Restore Assurance',conclusion:'success',updatedAt:isoOffset(-30)},
    {name:'Cloudflare Pages Production Deploy',conclusion:'success',updatedAt:isoOffset(-1)},
  ]}));
  await writeFile(x.pentest,'{}');
  await writeFile(x.tabletop,'{}');
  const run=spawnSync(process.execPath,[assuranceScript,x.incidents,x.audit,x.workflows,x.pentest,x.tabletop,x.evidence],{encoding:'utf8'});
  assert.equal(run.status,3);
  const evidence=JSON.parse(await readFile(x.evidence,'utf8'));
  assert.equal(evidence.finalStatus,'PENDING');
  assert.ok(evidence.blockers.includes('INDEPENDENT_PENTEST_ATTESTATION_REQUIRED'));
  assert.ok(evidence.blockers.includes('ANNUAL_TABLETOP_ATTESTATION_REQUIRED'));
});

test('P3 final assurance gate blocks unresolved High production incident',async()=>{
  const x=await setup();
  await writeFile(x.incidents,JSON.stringify([{results:[{
    id:'INC-HIGH',severity:'HIGH',status:'INVESTIGATING',rule_code:'TEST_HIGH',first_seen_at:isoOffset(-0.1)
  }]}]));
  await writeFile(x.audit,JSON.stringify({metadata:{vulnerabilities:{critical:0,high:0}}}));
  await writeFile(x.workflows,JSON.stringify({workflows:[]}));
  await writeFile(x.pentest,'{}');
  await writeFile(x.tabletop,'{}');
  const run=spawnSync(process.execPath,[assuranceScript,x.incidents,x.audit,x.workflows,x.pentest,x.tabletop,x.evidence],{encoding:'utf8'});
  assert.equal(run.status,3);
  const evidence=JSON.parse(await readFile(x.evidence,'utf8'));
  assert.equal(evidence.productionIncidents.highCriticalOpen,1);
  assert.ok(evidence.blockers.includes('OPEN_HIGH_CRITICAL_INCIDENTS:1'));
});

test('P3 ZAP gate fails High risk and preserves summarized evidence',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'proqpay-zap-'));
  const report=path.join(dir,'zap.json');
  const evidence=path.join(dir,'evidence.json');
  await writeFile(report,JSON.stringify({
    site:[{alerts:[
      {name:'High test',riskcode:'3',riskdesc:'High (Medium)',instances:[{},{}]},
      {name:'Medium test',riskcode:'2',riskdesc:'Medium (High)',instances:[{}]},
    ]}]
  }));
  const run=spawnSync(process.execPath,[zapScript,report,evidence],{encoding:'utf8'});
  assert.equal(run.status,2);
  const parsed=JSON.parse(await readFile(evidence,'utf8'));
  assert.equal(parsed.counts.highOrCritical,1);
  assert.equal(parsed.passed,false);
});

test('P3 workflow contracts keep DAST passive and human evidence explicit',async()=>{
  const dast=await readFile(new URL('../.github/workflows/security-dast.yml',import.meta.url),'utf8');
  const finalGate=await readFile(new URL('../.github/workflows/security-final-assurance.yml',import.meta.url),'utf8');
  const tabletop=await readFile(new URL('../.github/workflows/security-tabletop.yml',import.meta.url),'utf8');
  const doc=await readFile(new URL('../docs/security/SECURITY_ASSURANCE_P3.md',import.meta.url),'utf8');

  assert.match(dast,/zap-baseline\.py/);
  assert.doesNotMatch(dast,/zap-full-scan/);
  assert.match(finalGate,/INDEPENDENT_PENTEST_ATTESTATION_JSON/);
  assert.match(finalGate,/SECURITY_TABLETOP_ATTESTATION_JSON/);
  assert.match(finalGate,/fraud_incidents/);
  assert.match(tabletop,/Human security tabletop evidence is required/);
  assert.match(doc,/Automated ZAP evidence is not an independent penetration test/);
});

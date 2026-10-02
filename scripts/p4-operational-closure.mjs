import fs from 'node:fs';

const [healthPath,releasePath,assertPath,runsPath,issuesPath,backupPath,outPath='/tmp/p4-operational-closure.json']=process.argv.slice(2);
const required=[healthPath,releasePath,assertPath,runsPath,issuesPath,backupPath];
if(required.some((x)=>!x || !fs.existsSync(x))){
  console.error('Usage: node scripts/p4-operational-closure.mjs <health> <release> <assert> <runs> <issues> <backup> [out]');
  process.exit(2);
}
const read=(p)=>JSON.parse(fs.readFileSync(p,'utf8'));
const health=read(healthPath);
const release=read(releasePath);
const assertRaw=read(assertPath);
const runsRaw=read(runsPath);
const issuesRaw=read(issuesPath);
const backup=read(backupPath);
const now=Date.now();
const blockers=[];
const notes=[];

if(health?.ready!==true) blockers.push('PRODUCTION_NOT_READY');
if(health?.database!=='d1') blockers.push('DATABASE_NOT_D1');
if(health?.auth_mode!=='session') blockers.push('AUTH_MODE_NOT_SESSION');
if(Array.isArray(health?.checks) && health.checks.some((x)=>x?.status==='error')) blockers.push('HEALTH_ERROR_CHECK');

const expected=String(process.env.GITHUB_SHA||'').trim();
if(expected && release?.commit!==expected) blockers.push('RELEASE_NOT_CONVERGED');

const assertionRows=(Array.isArray(assertRaw)?assertRaw:[]).flatMap((x)=>x?.results||[]);
if(assertionRows.length) blockers.push('D1_OPERATIONAL_INVARIANT_VIOLATION');

if(backup?.ok!==true || backup?.integrity!=='ok') blockers.push('BACKUP_RESTORE_VERIFICATION_FAILED');

const workflowRequirements=[
  ['Production Security Uptime Monitor',24],
  ['Security D1 Backup & Restore Drill',36],
  ['Security Quarterly Restore Assurance',2400],
  ['Security Audit Integrity Checkpoint',36],
];
const runs=Array.isArray(runsRaw)?runsRaw:(runsRaw?.workflow_runs||[]);
const workflowEvidence={};
for(const [name,maxAgeHours] of workflowRequirements){
  const candidates=runs.filter((x)=>x?.name===name && x?.status==='completed').sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||'')));
  const latest=candidates[0]||null;
  const ageHours=latest?.created_at ? (now-Date.parse(latest.created_at))/3600000 : null;
  workflowEvidence[name]={latestRunId:latest?.id||null,conclusion:latest?.conclusion||null,createdAt:latest?.created_at||null,ageHours};
  if(!latest) blockers.push('MISSING_WORKFLOW_EVIDENCE:'+name);
  else if(latest.conclusion!=='success') blockers.push('WORKFLOW_NOT_GREEN:'+name);
  else if(!Number.isFinite(ageHours) || ageHours>maxAgeHours) blockers.push('STALE_WORKFLOW_EVIDENCE:'+name);
}

const issues=Array.isArray(issuesRaw)?issuesRaw:(issuesRaw?.issues||[]);
const blockingTitlePatterns=[
  /^SECURITY OPS:/i,
  /^SECURITY: dependency/i,
  /^SECURITY: DAST High\/Critical/i,
  /^SECURITY: audit integrity/i,
];
const openBlockingIssues=issues
  .filter((x)=>x?.state==='open')
  .filter((x)=>String(x?.title||'')!=='P4.4 OPS: operational closure gate failed')
  .filter((x)=>blockingTitlePatterns.some((re)=>re.test(String(x?.title||''))))
  .map((x)=>({number:x.number,title:x.title,url:x.html_url||x.url||null}));
if(openBlockingIssues.length) blockers.push('OPEN_OPERATIONAL_SECURITY_INCIDENT');

const evidence={
  generatedAt:new Date().toISOString(),
  phase:'P4.4 Operational Closure',
  commit:expected||release?.commit||null,
  status:blockers.length?'FAIL':'PASS',
  blockers,
  notes,
  production:{
    ready:health?.ready===true,
    database:health?.database||null,
    authMode:health?.auth_mode||null,
    releaseCommit:release?.commit||null,
  },
  recovery:{
    backupVerified:backup?.ok===true,
    integrity:backup?.integrity||null,
    bytes:backup?.bytes||null,
    checkedAt:backup?.checkedAt||null,
  },
  d1OperationalAssertions:{
    violations:assertionRows.length,
    rows:assertionRows,
  },
  workflowEvidence,
  openBlockingIssues,
};
fs.writeFileSync(outPath,JSON.stringify(evidence,null,2)+'\n');
console.log(JSON.stringify(evidence,null,2));
if(blockers.length) process.exit(1);

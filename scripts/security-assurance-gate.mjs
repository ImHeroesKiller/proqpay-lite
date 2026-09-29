import fs from 'node:fs';
import crypto from 'node:crypto';

const [incidentsPath,auditPath,workflowsPath,pentestPath,tabletopPath,evidencePath] = process.argv.slice(2);
if(!incidentsPath || !auditPath || !workflowsPath || !pentestPath || !tabletopPath || !evidencePath){
  throw new Error('Usage: node security-assurance-gate.mjs <incidents.json> <npm-audit.json> <workflow-evidence.json> <pentest-attestation.json> <tabletop-attestation.json> <evidence.json>');
}

function readJson(path,fallback={}){
  try{return JSON.parse(fs.readFileSync(path,'utf8'));}catch{return fallback;}
}
function flattenWrangler(value){
  const entries=Array.isArray(value)?value:[value];
  return entries.flatMap((entry)=>Array.isArray(entry?.results)?entry.results:[]);
}
function sha256(value){
  return crypto.createHash('sha256').update(value).digest('hex');
}
function validIsoDate(value){
  const time=Date.parse(String(value||''));
  return Number.isFinite(time)?time:null;
}
function daysOld(value){
  const time=validIsoDate(value);
  return time===null?Infinity:(Date.now()-time)/86_400_000;
}

const incidents=flattenWrangler(readJson(incidentsPath,[]));
const npmAudit=readJson(auditPath,{});
const workflowEvidence=readJson(workflowsPath,{workflows:[]});
const pentest=readJson(pentestPath,{});
const tabletop=readJson(tabletopPath,{});

const blockingIncidents=incidents.filter((row)=>
  ['CRITICAL','HIGH'].includes(String(row.severity||'').toUpperCase())
  && ['OPEN','ACKNOWLEDGED','INVESTIGATING','ESCALATED'].includes(String(row.status||'').toUpperCase())
);

const vuln=npmAudit?.metadata?.vulnerabilities || {};
const dependencyCritical=Number(vuln.critical||0);
const dependencyHigh=Number(vuln.high||0);

const requiredWorkflows=new Map([
  ['Security Dependency & Vulnerability Scan',2],
  ['Security D1 Backup & Restore Drill',2],
  ['Security Audit Integrity Checkpoint',2],
  ['Production Security Uptime Monitor',1],
  ['Security DAST Baseline',14],
  ['Cloudflare Pages Production Deploy',30],
]);

const workflowChecks=[];
for(const [name,maxAgeDays] of requiredWorkflows){
  const row=(workflowEvidence.workflows||[]).find((item)=>item.name===name);
  const age=row?.updatedAt ? daysOld(row.updatedAt) : Infinity;
  workflowChecks.push({
    name,
    conclusion:row?.conclusion||'missing',
    updatedAt:row?.updatedAt||null,
    ageDays:Number.isFinite(age)?Number(age.toFixed(2)):null,
    maxAgeDays,
    ok:Boolean(row && row.conclusion==='success' && age<=maxAgeDays),
  });
}

const pentestDate=validIsoDate(pentest.reportDate);
const pentestExpires=validIsoDate(pentest.validUntil);
const pentestChecks={
  present:Boolean(pentest && Object.keys(pentest).length),
  independent:pentest.assessorType==='INDEPENDENT_THIRD_PARTY',
  scopeIncludesCanonical:Array.isArray(pentest.scope) && pentest.scope.some((item)=>String(item).includes('proqpay.msg-os.com')),
  reportDateValid:Boolean(pentestDate && daysOld(pentest.reportDate)>=0 && daysOld(pentest.reportDate)<=365),
  validityCurrent:Boolean(pentestExpires && pentestExpires>Date.now()),
  reportSha256:/^[a-f0-9]{64}$/i.test(String(pentest.reportSha256||'')),
  criticalOpen:Number(pentest.criticalOpen),
  highOpen:Number(pentest.highOpen),
};
pentestChecks.ok=Boolean(
  pentestChecks.present
  && pentestChecks.independent
  && pentestChecks.scopeIncludesCanonical
  && pentestChecks.reportDateValid
  && pentestChecks.validityCurrent
  && pentestChecks.reportSha256
  && pentestChecks.criticalOpen===0
  && pentestChecks.highOpen===0
);

const tabletopDate=validIsoDate(tabletop.exerciseDate);
const tabletopChecks={
  present:Boolean(tabletop && Object.keys(tabletop).length),
  exerciseDateValid:Boolean(tabletopDate && daysOld(tabletop.exerciseDate)>=0 && daysOld(tabletop.exerciseDate)<=365),
  scenario:String(tabletop.scenario||'').trim().length>=10,
  participants:Number(tabletop.participantCount||0)>=2,
  actionsRecorded:Boolean(tabletop.actionsRecorded),
  evidenceSha256:/^[a-f0-9]{64}$/i.test(String(tabletop.evidenceSha256||'')),
};
tabletopChecks.ok=Object.values(tabletopChecks).every(Boolean);

const blockers=[];
if(blockingIncidents.length) blockers.push(`OPEN_HIGH_CRITICAL_INCIDENTS:${blockingIncidents.length}`);
if(dependencyCritical>0 || dependencyHigh>0) blockers.push(`DEPENDENCY_HIGH_CRITICAL:${dependencyCritical+dependencyHigh}`);
for(const row of workflowChecks) if(!row.ok) blockers.push(`WORKFLOW_NOT_CURRENT:${row.name}`);
if(!pentestChecks.ok) blockers.push('INDEPENDENT_PENTEST_ATTESTATION_REQUIRED');
if(!tabletopChecks.ok) blockers.push('ANNUAL_TABLETOP_ATTESTATION_REQUIRED');

const evidence={
  generatedAt:new Date().toISOString(),
  assuranceModel:'ProQPay P3 Final Security Assurance',
  canonicalTarget:'https://proqpay.msg-os.com',
  productionIncidents:{
    highCriticalOpen:blockingIncidents.length,
    items:blockingIncidents.map((row)=>({
      id:row.id,
      severity:row.severity,
      status:row.status,
      ruleCode:row.rule_code,
      firstSeenAt:row.first_seen_at,
    })),
  },
  dependencyAudit:{
    critical:dependencyCritical,
    high:dependencyHigh,
  },
  workflowChecks,
  independentPentest:pentestChecks,
  annualTabletop:tabletopChecks,
  attestationDigests:{
    pentest:pentestChecks.present?sha256(JSON.stringify(pentest)):null,
    tabletop:tabletopChecks.present?sha256(JSON.stringify(tabletop)):null,
  },
  blockers,
  finalStatus:blockers.length?'PENDING':'PASS',
};
fs.writeFileSync(evidencePath,JSON.stringify(evidence,null,2)+'\n');
console.log(JSON.stringify(evidence,null,2));
if(blockers.length) process.exit(3);

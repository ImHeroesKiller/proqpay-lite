#!/usr/bin/env node
import {readFileSync,writeFileSync} from 'node:fs';
const [a,b,output]=process.argv.slice(2);
if(!a||!b||!output)throw new Error('Usage: p582-validate-readiness <a.json> <b.json> <out.json>');
const expected=['ELIGIBLE_PI','ELIGIBLE_SNAPSHOT_VALID','ELIGIBLE_PI_PROVIDER_BOUND','ELIGIBLE_PI_LEGACY_MANUAL','ELIGIBLE_PI_CREDENTIAL_HEALTHY','ELIGIBLE_DIRECT_CHANNEL_RECORDED','ELIGIBLE_PI_APPROVED_HASH','ELIGIBLE_PARENT_BALANCE_FRESH','ELIGIBLE_SUBCLIENT_BALANCE_FRESH','ELIGIBLE_ACTIVE_LIMIT_RECORDED'];
const parsed=[a,b].map(p=>JSON.parse(readFileSync(p,'utf8')));
if(parsed.some(p=>!Array.isArray(p)||p.length!==5||p.some(r=>r.success!==true||!Array.isArray(r.results)||r.results.length!==1)))throw new Error('Invalid D1 response: FAIL CLOSED');
const rows=parsed.flatMap(p=>p.flatMap(x=>x.results));
if(rows.length!==expected.length||new Set(rows.map(x=>x.metric)).size!==expected.length||expected.some(k=>!rows.some(x=>x.metric===k)))throw new Error('Missing or duplicate readiness metric: FAIL CLOSED');
const metrics={};
for(const row of rows){
 const n=Number(row.records),amount=Number(row.amount_idr);
 if(!Number.isSafeInteger(n)||n<0||!Number.isSafeInteger(amount)||amount<0)throw new Error('Invalid aggregate: FAIL CLOSED');
 metrics[row.metric]={count:n,amountIdr:amount};
}
for(const name of expected.slice(1))if(metrics[name].count>metrics.ELIGIBLE_PI.count)throw new Error(`${name} exceeds eligible count`);
const blockers=[];
if(metrics.ELIGIBLE_PI_LEGACY_MANUAL.count)blockers.push('LEGACY_CREDENTIAL_RECOVERY_REQUIRED');
if(metrics.ELIGIBLE_SNAPSHOT_VALID.count<metrics.ELIGIBLE_PI.count)blockers.push('PI_SNAPSHOT_VALIDATION_REQUIRED');
if(metrics.ELIGIBLE_PI_PROVIDER_BOUND.count<metrics.ELIGIBLE_PI.count)blockers.push('PI_ROUTING_REVIEW_REQUIRED');
if(metrics.ELIGIBLE_PI_CREDENTIAL_HEALTHY.count<metrics.ELIGIBLE_PI.count)blockers.push('SCOPED_CREDENTIAL_NOT_READY');
if(metrics.ELIGIBLE_DIRECT_CHANNEL_RECORDED.count<metrics.ELIGIBLE_PI.count)blockers.push('PROVIDER_CHANNEL_EVIDENCE_REQUIRED');
if(metrics.ELIGIBLE_PARENT_BALANCE_FRESH.count<metrics.ELIGIBLE_PI.count||metrics.ELIGIBLE_SUBCLIENT_BALANCE_FRESH.count<metrics.ELIGIBLE_PI.count)blockers.push('FUNDING_REFRESH_REQUIRED');
if(metrics.ELIGIBLE_ACTIVE_LIMIT_RECORDED.count<metrics.ELIGIBLE_PI.count)blockers.push('CONTROLLER_APPROVED_LIMIT_REQUIRED');
const report={phase:'P5.8.2',mode:'READ_ONLY_D1_UAT',generatedAt:new Date().toISOString(),financialWrites:false,payoutsAttempted:false,credentialsRecovered:false,readyForAutomaticDisbursement:false,metrics,blockers};
writeFileSync(output,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));

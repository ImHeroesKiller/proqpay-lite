#!/usr/bin/env node
import {readFileSync,writeFileSync} from 'node:fs';
const [source,output]=process.argv.slice(2);
if(!source||!output)throw new Error('Usage: p58-validate-inventory.mjs <wrangler-json> <safe-report-json>');
const parsed=JSON.parse(readFileSync(source,'utf8'));
if(!Array.isArray(parsed)||parsed.length!==1||parsed[0]?.success!==true||!Array.isArray(parsed[0]?.results)){
 throw new Error('Production D1 inventory did not return successful structured results: FAIL CLOSED');
}
const keys=['ORGANIZATIONS','CLIENTS','PROJECTS','EMPLOYEES','PAYMENT_INSTRUCTIONS','GATEWAY_TRANSACTIONS','GATEWAY_ITEMS','GATEWAY_INFLIGHT','GATEWAY_TERMINAL','PI_CANONICAL_ELIGIBLE_NO_FINANCIAL_ACTIVITY','PI_GATEWAY_AND_CANONICAL_COLLISIONS','PI_GATEWAY_NO_CANONICAL','CANONICAL_REQUESTS','CANONICAL_EXECUTIONS','EWA_DISBURSED_OR_REPAID','EWA_CANDIDATE_APPROVED_WITHOUT_CANONICAL','E2PAY_SUBACCOUNTS','SUBACCOUNT_CREDENTIAL_MANUAL','SUBACCOUNT_CREDENTIAL_HEALTHY','LEGACY_COMPATIBILITY','LEGACY_RECOVERY_REQUIRED','LEGACY_RETAIN_ONLY','LIMIT_RESERVED_LEGACY','CORPORATE_PRIMARY_UNGOVERNED'];
const records=parsed[0].results;
if(records.length!==keys.length||new Set(records.map(x=>x.metric)).size!==keys.length||keys.some(k=>!records.some(x=>x.metric===k)))throw new Error('Missing/duplicated inventory metrics: FAIL CLOSED');
const metrics={};
for(const row of records){
 const count=Number(row.records),amount=Number(row.amount_idr);
 if(!Number.isSafeInteger(count)||count<0||!Number.isSafeInteger(amount)||amount<0)throw new Error(`Invalid aggregate for ${row.metric}`);
 metrics[row.metric]={records:count,amountIdr:amount};
}
if(metrics.GATEWAY_INFLIGHT.records+metrics.GATEWAY_TERMINAL.records!==metrics.GATEWAY_TRANSACTIONS.records)throw new Error('Gateway status reconciliation failed');
const blockers=[];
if(metrics.PI_GATEWAY_AND_CANONICAL_COLLISIONS.records>0)blockers.push('DOUBLE_STRATEGY_FINANCIAL_COLLISION');
if(metrics.GATEWAY_INFLIGHT.records>0)blockers.push('LEGACY_INFLIGHT_REQUIRES_RECONCILIATION');
if(metrics.SUBACCOUNT_CREDENTIAL_MANUAL.records>0)blockers.push('LEGACY_CREDENTIAL_RECOVERY_REQUIRED');
if(metrics.CORPORATE_PRIMARY_UNGOVERNED.records>0)blockers.push('CORPORATE_MAKER_CHECKER_REVIEW');
const report={phase:'P5.8',mode:'READ_ONLY_INVENTORY',generatedAt:new Date().toISOString(),financialExecutionAllowed:false,automaticCutoverAllowed:false,sourceRecordsUntouched:true,metrics,blockers,readyForAutomaticCutover:false};
writeFileSync(output,JSON.stringify(report,null,2));
console.log(JSON.stringify({phase:report.phase,mode:report.mode,blockers,metrics},null,2));

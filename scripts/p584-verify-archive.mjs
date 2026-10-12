#!/usr/bin/env node
import {readFileSync,writeFileSync} from 'node:fs';
const [source,target]=process.argv.slice(2);
if(!source||!target)throw new Error('Expected JSON source and output paths');
const result=JSON.parse(readFileSync(source,'utf8'));
if(!Array.isArray(result)||result.length!==1||result[0].success!==true||result[0].results?.length!==1)throw new Error('Invalid D1 archive verification response');
const fields=['archived_count','archived_amount','verified_source_matches','false_financial_claims','active_gateway_collisions','canonical_dr_collisions','missing_provenance'];
const metrics={};
for(const key of fields){const n=Number(result[0].results[0][key]);if(!Number.isSafeInteger(n)||n<0)throw new Error(`Invalid aggregate ${key}`);metrics[key]=n;}
const verified=metrics.archived_count>0&&metrics.verified_source_matches===metrics.archived_count
 &&metrics.false_financial_claims===0&&metrics.active_gateway_collisions===0
 &&metrics.canonical_dr_collisions===0&&metrics.missing_provenance===0;
const report={phase:'P5.8.4',mode:'READ_ONLY_POST_DEPLOY_AUDIT',generatedAt:new Date().toISOString(),
 financialExecutionAttempted:false,providerSettlementRecorded:false,hardDeleteExecuted:false,
 passed:verified,metrics};
writeFileSync(target,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
if(!verified)throw new Error('UAT archive source integrity/financial guard verification FAILED CLOSED');

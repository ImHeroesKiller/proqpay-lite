#!/usr/bin/env node
import {readFileSync,writeFileSync} from 'node:fs';
const [input,output]=process.argv.slice(2);
if(!input||!output)throw new Error('Expected aggregate D1 input and output paths');
const parsed=JSON.parse(readFileSync(input,'utf8'));
const expected=['UAT_E2PAY_ACCOUNTS','UAT_PROVIDER_LINKED_PI','UAT_PROVIDER_LINKED_GATEWAY','UAT_PROVIDER_LINKED_CANONICAL','UAT_CUTOVER_CATALOG_RECORDS'];
if(!Array.isArray(parsed)||parsed.length!==expected.length||parsed.some(r=>r.success!==true||r.results?.length!==1))throw new Error('Incomplete D1 read-only reset preflight: FAIL CLOSED');
const metrics={};for(let i=0;i<expected.length;i++){
 const row=parsed[i].results[0];
 const count=Number(row.records);
 if(row.metric!==expected[i]||!Number.isSafeInteger(count)||count<0)throw new Error('Unexpected metric response: FAIL CLOSED');
 metrics[row.metric]=count;
}
const protectedReferences=metrics.UAT_PROVIDER_LINKED_PI+metrics.UAT_PROVIDER_LINKED_GATEWAY+metrics.UAT_PROVIDER_LINKED_CANONICAL+metrics.UAT_CUTOVER_CATALOG_RECORDS;
const report={phase:'P5.8.3',mode:'READ_ONLY_UAT_RESET_PREFLIGHT',createdAt:new Date().toISOString(),
 metrics,hardDeleteEligible:protectedReferences===0&&metrics.UAT_E2PAY_ACCOUNTS>0,
 hardDeleteExecuted:false,piCopied:false,sourceDataDeleted:false,
 reason:protectedReferences>0?'UAT_PROVIDER_REFERENCED_BY_FINANCIAL_OR_CUTOVER_RECORDS':'NO_REFERENCES_FOUND_STILL_REQUIRES_BACKUP_AND_SCOPED_AUTHORIZATION'};
writeFileSync(output,JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));

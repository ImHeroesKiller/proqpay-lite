#!/usr/bin/env node
import {readFileSync,writeFileSync} from 'node:fs';
const [source,target]=process.argv.slice(2);
if(!source||!target)throw new Error('Expected Wrangler JSON and report destination');
const rows=JSON.parse(readFileSync(source,'utf8'));
if(!Array.isArray(rows)||rows.length!==1||rows[0].success!==true||rows[0].results?.length!==1)throw new Error('P5.8.5 invalid D1 aggregate output: FAIL CLOSED');
const required=['uat_active_accounts','archived_uat_hidden_accounts','production_accounts_unaffected','closed_uat_instructions','closed_uat_amount_idr','closed_uat_gateway_collisions','closed_uat_dr_collisions'];
const m={};for(const key of required){const v=Number(rows[0].results[0][key]);if(!Number.isSafeInteger(v)||v<0)throw new Error('Invalid metric '+key);m[key]=v;}
const passed=m.closed_uat_instructions>0&&m.archived_uat_hidden_accounts>0
 &&m.archived_uat_hidden_accounts<=m.uat_active_accounts
 &&m.closed_uat_gateway_collisions===0&&m.closed_uat_dr_collisions===0;
const report={phase:'P5.8.5',mode:'READ_ONLY_POST_DEPLOY',createdAt:new Date().toISOString(),
 financialExecutionAttempted:false,providerSettlementRecorded:false,sourceDataDeleted:false,passed,metrics:m};
writeFileSync(target,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
if(!passed)throw new Error('Archived UAT visibility integrity check FAIL CLOSED');

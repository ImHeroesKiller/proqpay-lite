import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as runtime from 'miniflare';
import {unstable_splitSqlQuery} from 'wrangler';
import {applyEwaRepayments,markEwaRepaid} from '../functions/api/_ewa.js';

// Use the actual local D1 binding: meta.changes includes trigger writes, unlike
// DatabaseSync.run().changes. Keep this regression independent of D1Mock.
test('local D1 runtime migrates and atomically claims/collects EWA exactly once',{timeout:60000},async()=>{
 const options={modules:true,script:'export default {fetch(){return new Response("local-test")}}',d1Databases:['DB']};
 const mf=new runtime.Miniflare(runtime.convertV4MiniflareOptions?runtime.convertV4MiniflareOptions(options):options);
 try {
   const DB=await mf.getD1Database('DB');
   const directory=new URL('../migrations/',import.meta.url);
   for(const name of fs.readdirSync(directory).filter(n=>n.endsWith('.sql')).sort()){
     const sql=fs.readFileSync(new URL(name,directory),'utf8');
     await DB.batch(unstable_splitSqlQuery(sql).map(statement=>DB.prepare(statement)));
   }
   await DB.exec(`
     INSERT INTO organizations(id,name,code) VALUES('D1-O','D1 runtime','D1');
     INSERT INTO clients(id,org_id,name,code) VALUES('D1-C','D1-O','Synthetic','D1-C');
     INSERT INTO employees(id,org_id,client_id,name) VALUES('D1-E','D1-O','D1-C','Synthetic');
     INSERT INTO client_service_plans(id,client_id,tier,status,effective_from,created_by) VALUES('D1-SP','D1-C','TIER_2_MANAGED_PAYROLL','ACTIVE','2026-01-01','seed');
     INSERT INTO payroll_submissions(id,org_id,client_id,service_plan_id,service_tier,period,state,created_by,run_type) VALUES('D1-S','D1-O','D1-C','D1-SP','TIER_2_MANAGED_PAYROLL','2026-11','DRAFT','seed','REGULAR');
     INSERT INTO payroll_run_lines(id,submission_id,employee_id,employee_name,source,gross_amount,deduction_amount,net_amount,components) VALUES('D1-L','D1-S','D1-E','Synthetic','TEST',1000000,0,1000000,'{"sewaRumah":0}');
     INSERT INTO ewa_requests(id,org_id,client_id,employee_id,period,amount,fee,repayment,status) VALUES('D1-R','D1-O','D1-C','D1-E','2026-11',200000,50000,250000,'DISBURSED');
   `);
   assert.deepEqual(await applyEwaRepayments(DB,'D1-S'),{applied:1});
   assert.deepEqual(await applyEwaRepayments(DB,'D1-S'),{applied:0});
   assert.equal((await DB.prepare("SELECT net_amount FROM payroll_run_lines WHERE id='D1-L'").first()).net_amount,750000);
   assert.deepEqual(await markEwaRepaid(DB,'D1-S'),{collected:0});
   await assert.rejects(DB.prepare("UPDATE payroll_run_lines SET included=0 WHERE id='D1-L'").run(),/EWA_ALLOCATED_PAYROLL_LINE_LOCKED/);
   await DB.exec(`
     INSERT INTO payment_instructions(id,org_id,client_id,submission_id,status,expected_total,creator_user_id,idempotency_key,content_hash,recipient_count) VALUES('D1-PI','D1-O','D1-C','D1-S','COMPLETED',750000,'seed','D1-PI-IDEM','synthetic-hash',1);
     INSERT INTO payment_instruction_lines(id,payment_instruction_id,employee_id,beneficiary_name,bank_name,masked_account,account_ciphertext,account_iv,account_last4,line_hash,amount) VALUES('D1-PIL','D1-PI','D1-E','Synthetic','BCA','****1234','synthetic','synthetic','1234','synthetic-line-hash',750000);
     INSERT INTO reconciliations(id,payment_instruction_id,expected_total,instruction_total,proof_total,difference,status) VALUES('D1-REC','D1-PI',750000,750000,750000,0,'MATCHED');
   `);
   assert.deepEqual(await markEwaRepaid(DB,'D1-S'),{collected:1});
   assert.deepEqual(await markEwaRepaid(DB,'D1-S'),{collected:0});
   assert.equal((await DB.prepare("SELECT status FROM ewa_requests WHERE id='D1-R'").first()).status,'REPAID');
   assert.equal((await DB.prepare("SELECT COUNT(*) n FROM audit_logs WHERE entity_id='D1-R'").first()).n,2);
 } finally {await mf.dispose();}
});

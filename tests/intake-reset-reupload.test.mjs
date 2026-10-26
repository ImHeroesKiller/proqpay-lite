import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {D1Mock} from './helpers/d1-mock.mjs';

const source=readFileSync(new URL('../functions/api/payroll-intake.js',import.meta.url),'utf8');
const find=source.match(/"(SELECT id,r2_object_key FROM payroll_upload_batches WHERE org_id=\?[^"\n]+status='CANCELLED' LIMIT 1)"/)[1];
const restore=source.match(/"(UPDATE payroll_upload_batches SET status=\?,validation_summary=\? WHERE id=\?[^"\n]+status='CANCELLED')"/)[1];
const insertRow=source.match(/statement: `(INSERT INTO payroll_upload_rows[^`]+)`/)[1];

test('reset and same-file reupload preserves one source and row identities for 100 employees',()=>{
 const db=new D1Mock();
 db.sqlite.exec(`INSERT INTO payroll_upload_batches(id,org_id,submission_id,original_filename,r2_object_key,file_sha256,uploaded_by,status,accepted_row_count)
 VALUES('BATCH','ORG','SUB','100.xlsx','original-source','HASH','client@test','CANCELLED',100)`);
 const insert=db.sqlite.prepare(insertRow);
 for(let i=1;i<=100;i++)insert.run('ROW-'+i,'BATCH',i,null,'{}','{}','ACCEPTED','[]','HASH-'+i);
 assert.throws(()=>db.sqlite.exec(`INSERT INTO payroll_upload_batches(id,org_id,submission_id,original_filename,r2_object_key,file_sha256,uploaded_by) VALUES('DUP','ORG','SUB','100.xlsx','new-source','HASH','client@test')`),/UNIQUE/);
 assert.equal(db.sqlite.prepare(find).get('OTHER','SUB','HASH'),undefined);
 const batch=db.sqlite.prepare(find).get('ORG','SUB','HASH');
 assert.equal(batch.id,'BATCH');assert.equal(batch.r2_object_key,'original-source');
 const retained=db.sqlite.prepare('SELECT row_no,row_hash FROM payroll_upload_rows WHERE batch_id=?').all(batch.id);
 assert.equal(retained.length,100);
 assert.throws(()=>db.sqlite.exec("UPDATE payroll_upload_rows SET raw_payload='changed' WHERE row_no=1"),/PAYROLL_SOURCE_ROW_IMMUTABLE/);
 for(let i=1;i<=100;i++)assert.equal(retained.find(row=>row.row_no===i).row_hash,'HASH-'+i);
 assert.equal(db.sqlite.prepare(restore).run('READY_TO_CONFIRM','{"employees":100}',batch.id,'ORG','SUB','HASH').changes,1);
 assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM payroll_upload_batches').get().n,1);
 assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM payroll_upload_rows').get().n,100);
 assert.equal(db.sqlite.prepare("SELECT id FROM payroll_upload_rows WHERE row_no=1").get().id,'ROW-1');
 assert.equal(db.sqlite.prepare(restore).run('READY_TO_CONFIRM','{}',batch.id,'ORG','SUB','HASH').changes,0);
 db.sqlite.exec("UPDATE payroll_upload_batches SET status='IMPORTED' WHERE id='BATCH'");
 assert.equal(db.sqlite.prepare(find).get('ORG','SUB','HASH'),undefined);
 assert.equal(db.sqlite.prepare(restore).run('READY_TO_CONFIRM','{}',batch.id,'ORG','SUB','HASH').changes,0);
});

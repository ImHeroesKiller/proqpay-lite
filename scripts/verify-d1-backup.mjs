import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const file=process.argv[2];
if(!file || !fs.existsSync(file)){
  console.error('Usage: node scripts/verify-d1-backup.mjs <export.sql>');
  process.exit(2);
}
const sql=fs.readFileSync(file,'utf8');
if(sql.length<100){
  console.error('Backup file is unexpectedly small.');
  process.exit(1);
}

const requiredTables=[
  'app_users',
  'app_sessions',
  'clients',
  'projects',
  'employees',
  'employee_bank_accounts',
  'payroll_submissions',
  'payment_instructions',
  'payment_gateway_transactions',
  'audit_logs',
];

const missingText=requiredTables.filter((name)=>!new RegExp(`CREATE TABLE(?: IF NOT EXISTS)? [\`"]?${name}[\`"]?`,'i').test(sql));
if(missingText.length){
  console.error('Backup export is missing required schema:',missingText.join(', '));
  process.exit(1);
}

const db=new DatabaseSync(':memory:');
try{
  db.exec(sql);
  const integrity=db.prepare('PRAGMA integrity_check').get();
  const result=Object.values(integrity||{})[0];
  if(String(result).toLowerCase()!=='ok') throw new Error(`integrity_check=${result}`);
  const present=new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row)=>row.name));
  const missingRestore=requiredTables.filter((name)=>!present.has(name));
  if(missingRestore.length) throw new Error(`restored database missing: ${missingRestore.join(', ')}`);
  const evidence={
    ok:true,
    checkedAt:new Date().toISOString(),
    bytes:Buffer.byteLength(sql),
    requiredTables:requiredTables.length,
    integrity:'ok',
  };
  fs.writeFileSync('/tmp/proqpay-backup-verification.json',JSON.stringify(evidence,null,2));
  console.log(JSON.stringify(evidence));
}finally{
  db.close();
}

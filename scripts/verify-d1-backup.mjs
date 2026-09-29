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

function stripOrphanSchema(source){
  const declaredTables=new Set(
    [...source.matchAll(/CREATE TABLE(?: IF NOT EXISTS)? [`"]?([A-Za-z0-9_]+)[`"]?/gi)]
      .map((match)=>String(match[1]).toLowerCase())
  );
  const skipped=[];
  const sanitized=source.replace(
    /CREATE\s+(?:UNIQUE\s+)?INDEX(?:\s+IF\s+NOT\s+EXISTS)?\s+[^;]+?\s+ON\s+[`"]?([A-Za-z0-9_]+)[`"]?\s*\([^;]+?\);/gi,
    (statement,table)=>{
      if(declaredTables.has(String(table).toLowerCase())) return statement;
      skipped.push({type:'ORPHAN_INDEX',table:String(table),statement:statement.slice(0,240)});
      return `-- skipped orphan index for absent table ${table}`;
    },
  );
  const triggerSanitized=sanitized.replace(
    /CREATE\s+TRIGGER[\s\S]*?\bEND\s*;/gi,
    (statement)=>{
      const dependencies=[
        ...statement.matchAll(/\b(?:FROM|JOIN|UPDATE|INTO)\s+[`"]?([A-Za-z0-9_]+)[`"]?/gi),
      ].map((match)=>String(match[1]).toLowerCase());
      const missing=[...new Set(dependencies.filter((name)=>!declaredTables.has(name)))];
      if(!missing.length) return statement;
      skipped.push({
        type:'ORPHAN_TRIGGER',
        tables:missing,
        statement:statement.slice(0,240),
      });
      return `-- skipped orphan trigger referencing absent table(s): ${missing.join(', ')}`;
    },
  );
  return {sanitized:triggerSanitized,skipped};
}

const {sanitized,skipped}=stripOrphanSchema(sql);
const declaredTables=new Set(
  [...sql.matchAll(/CREATE TABLE(?: IF NOT EXISTS)? [`"]?([A-Za-z0-9_]+)[`"]?/gi)]
    .map((match)=>String(match[1]).toLowerCase())
);
const orphanForeignKeys=[
  ...new Set(
    [...sql.matchAll(/\bREFERENCES\s+[`"]?([A-Za-z0-9_]+)[`"]?/gi)]
      .map((match)=>String(match[1]).toLowerCase())
      .filter((name)=>!declaredTables.has(name))
  ),
];
for(const table of orphanForeignKeys){
  skipped.push({type:'ORPHAN_FOREIGN_KEY',table});
}

const db=new DatabaseSync(':memory:');
try{
  // D1 exports can contain historical FK references whose parent table was retired.
  // Disaster-recovery import loads data first, then validates SQLite structural integrity.
  db.exec('PRAGMA foreign_keys=OFF;');
  db.exec(sanitized);
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
    skippedOrphanSchemaArtifacts:skipped,
  };
  fs.writeFileSync('/tmp/proqpay-backup-verification.json',JSON.stringify(evidence,null,2));
  console.log(JSON.stringify(evidence));
}finally{
  db.close();
}

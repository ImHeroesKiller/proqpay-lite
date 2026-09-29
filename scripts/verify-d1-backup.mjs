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

function splitSqlStatements(source){
  const statements=[];
  let current='';
  let token='';
  let quote=null;
  let lineComment=false;
  let blockComment=false;
  let trigger=false;
  let triggerBody=false;
  let triggerEnd=false;
  let caseDepth=0;
  const leading=[];

  function pushToken(){
    if(!token)return;
    const word=token.toUpperCase();
    if(leading.length<4)leading.push(word);
    if(leading[0]==='CREATE' && leading.includes('TRIGGER'))trigger=true;
    if(trigger){
      if(word==='BEGIN' && !triggerBody)triggerBody=true;
      else if(triggerBody && word==='CASE')caseDepth+=1;
      else if(triggerBody && word==='END'){
        if(caseDepth>0)caseDepth-=1;
        else triggerEnd=true;
      }
    }
    token='';
  }

  function finish(){
    pushToken();
    const value=current.trim();
    if(value)statements.push(value);
    current='';
    token='';
    quote=null;
    lineComment=false;
    blockComment=false;
    trigger=false;
    triggerBody=false;
    triggerEnd=false;
    caseDepth=0;
    leading.length=0;
  }

  for(let index=0;index<source.length;index+=1){
    const char=source[index];
    const next=source[index+1]||'';

    if(lineComment){
      current+=char;
      if(char==='\n')lineComment=false;
      continue;
    }
    if(blockComment){
      current+=char;
      if(char==='*' && next==='/'){
        current+=next;
        index+=1;
        blockComment=false;
      }
      continue;
    }
    if(quote){
      current+=char;
      if(quote===']'){
        if(char===']')quote=null;
      }else if(char===quote){
        if((quote==="'" || quote==='"') && next===quote){
          current+=next;
          index+=1;
        }else{
          quote=null;
        }
      }
      continue;
    }

    if(char==='-' && next==='-'){
      pushToken();
      current+=char+next;
      index+=1;
      lineComment=true;
      continue;
    }
    if(char==='/' && next==='*'){
      pushToken();
      current+=char+next;
      index+=1;
      blockComment=true;
      continue;
    }
    if(char==="'" || char==='"' || char==='`' || char==='['){
      pushToken();
      quote=char==='['?']':char;
      current+=char;
      continue;
    }
    if(/[A-Za-z0-9_]/.test(char)){
      token+=char;
      current+=char;
      continue;
    }

    pushToken();
    current+=char;
    if(char===';' && (!trigger || (triggerBody && triggerEnd))){
      finish();
    }
  }
  if(current.trim())finish();
  return statements;
}

function withoutLeadingComments(statement){
  return statement
    .replace(/^\s*(?:--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/\s*)*/,'')
    .trim();
}

function category(statement){
  const clean=withoutLeadingComments(statement);
  if(!clean)return 'ignore';
  if(/^(BEGIN(?:\s+TRANSACTION)?|COMMIT|END(?:\s+TRANSACTION)?|PRAGMA\b)/i.test(clean))return 'ignore';
  if(/^CREATE\s+(?:TEMP\s+)?(?:VIRTUAL\s+)?TABLE\b/i.test(clean))return 'table';
  if(/^(INSERT|REPLACE|UPDATE|DELETE)\b/i.test(clean))return 'data';
  if(/^CREATE\s+(?:UNIQUE\s+)?INDEX\b/i.test(clean))return 'post-schema';
  if(/^CREATE\s+(?:TEMP\s+)?TRIGGER\b/i.test(clean))return 'post-schema';
  if(/^CREATE\s+(?:TEMP\s+)?VIEW\b/i.test(clean))return 'post-schema';
  if(/^DROP\b/i.test(clean))return 'ignore';
  return 'other';
}

const statements=splitSqlStatements(sql);
const groups={table:[],data:[],'post-schema':[],other:[],ignore:[]};
for(const statement of statements)groups[category(statement)].push(statement);

const db=new DatabaseSync(':memory:');
try{
  db.exec('PRAGMA foreign_keys=OFF;');
  db.exec('BEGIN;');
  try{
    for(const statement of groups.table)db.exec(statement);
    for(const statement of groups.other)db.exec(statement);
    for(const statement of groups.data)db.exec(statement);
    for(const statement of groups['post-schema'])db.exec(statement);
    db.exec('COMMIT;');
  }catch(error){
    try{db.exec('ROLLBACK;');}catch{}
    throw error;
  }

  db.exec('PRAGMA foreign_keys=ON;');

  const integrity=db.prepare('PRAGMA integrity_check').get();
  const integrityResult=Object.values(integrity||{})[0];
  if(String(integrityResult).toLowerCase()!=='ok')throw new Error(`integrity_check=${integrityResult}`);

  const foreignKeyViolations=db.prepare('PRAGMA foreign_key_check').all();
  if(foreignKeyViolations.length){
    throw new Error(`foreign_key_check=${foreignKeyViolations.length} violation(s)`);
  }

  const present=new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row)=>row.name));
  const missingRestore=requiredTables.filter((name)=>!present.has(name));
  if(missingRestore.length)throw new Error(`restored database missing: ${missingRestore.join(', ')}`);

  const tableCount=db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").get()?.count||0;
  const evidence={
    ok:true,
    checkedAt:new Date().toISOString(),
    bytes:Buffer.byteLength(sql),
    statements:statements.length,
    restoredTables:Number(tableCount),
    requiredTables:requiredTables.length,
    integrity:'ok',
    foreignKeyViolations:0,
    restoreOrder:'tables-data-post-schema',
  };
  fs.writeFileSync('/tmp/proqpay-backup-verification.json',JSON.stringify(evidence,null,2));
  console.log(JSON.stringify(evidence));
}finally{
  db.close();
}

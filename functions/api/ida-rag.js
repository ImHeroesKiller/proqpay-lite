import { d1All, d1Batch, d1First, hasD1 } from './_d1.js';

const KNOWLEDGE=[
  {id:'flow-payroll',tags:['payroll','hitung','approval','payment','alur','flow'],text:'Alur payroll ProQPay memakai payroll submission terkontrol, validasi, review processor, review controller, Payment Instruction immutable, maker-checker approval, proof, dan reconciliation.'},
  {id:'margin',tags:['margin','laba','profit','invoice','revenue'],text:'Margin outsourcing = invoice client dikurangi biaya payroll. Revenue hanya dihitung dari billing rule aktif; tanpa rule, perhitungan harus dihentikan.'},
  {id:'umr',tags:['umr','umk','gaji minimum','upah'],text:'UMR/UMK harus mengikuti lokasi penempatan dan periode regulasi yang berlaku. Evidence lokasi dan tahun wajib disebutkan.'},
  {id:'import',tags:['import','excel','upload','hris'],text:'Import HRIS diparsing di aplikasi, divalidasi, lalu ditulis atomically ke Cloudflare D1 beserta submission payroll dan audit trail.'},
  {id:'bpjs-pph',tags:['bpjs','pph','potongan','pajak'],text:'BPJS dan PPh21 harus dihitung deterministik berdasarkan konfigurasi dan regulasi periode terkait; IDA tidak boleh mengarang nilai.'},
];
function score(q,doc) { const text=q.toLowerCase();let value=0;for(const tag of doc.tags) if(text.includes(tag)) value+=2;for(const word of text.split(/\s+/)) if(word.length>3&&doc.text.toLowerCase().includes(word)) value+=1;return value; }
function scope(actor,column='client_id') {
  const ids=actor?.role==='CLIENT_USER'&&Array.isArray(actor.clientIds)?actor.clientIds.map(String):[];
  if (actor?.role!=='CLIENT_USER') return {sql:'',bindings:[]};
  if (!ids.length) return {sql:' AND 1=0',bindings:[]};
  return {sql:` AND ${column} IN (${ids.map(()=>'?').join(',')})`,bindings:ids};
}

export async function retrieveRag(env,userText,limit=6,actor=null) {
  const q=String(userText||'').toLowerCase(),chunks=KNOWLEDGE.map((doc)=>({...doc,score:score(q,doc)})).filter((doc)=>doc.score>0)
    .sort((a,b)=>b.score-a.score).slice(0,3).map((doc)=>({source:'knowledge',id:doc.id,text:doc.text}));
  if (!hasD1(env)) return [...chunks,{source:'system',text:'Cloudflare D1 belum terhubung — RAG DB offline.'}].slice(0,limit);
  try {
    const employeeScope=scope(actor,'client_id'),clientScope=scope(actor,'id');
    if (/karyawan|pegawai|employee|nrk|berapa orang|headcount/.test(q)) {
      const stats=await d1All(env.DB,`SELECT status_aktif,province,COUNT(*) AS n FROM employees WHERE 1=1${employeeScope.sql}
        GROUP BY status_aktif,province ORDER BY n DESC LIMIT 20`,employeeScope.bindings);
      const total=await d1First(env.DB,`SELECT COUNT(*) AS n FROM employees WHERE 1=1${employeeScope.sql}`,employeeScope.bindings);
      chunks.push({source:'db',id:'emp-stats',text:`D1 employees total=${total?.n||0}. Breakdown: ${JSON.stringify(stats).slice(0,900)}`});
    }
    if (/provinsi|wilayah|cabang|lokasi|map/.test(q)) {
      const rows=await d1All(env.DB,`SELECT province,COUNT(*) AS n FROM employees WHERE province IS NOT NULL${employeeScope.sql}
        GROUP BY province ORDER BY n DESC LIMIT 15`,employeeScope.bindings);
      chunks.push({source:'db',id:'by-province',text:`Karyawan per provinsi: ${JSON.stringify(rows)}`});
    }
    if (/margin|invoice|laba|revenue|outstanding|piutang/.test(q)) {
      const invoiceScope=scope(actor,'client_id');
      const rows=await d1All(env.DB,`SELECT period,status,SUM(total_amount) AS total,COUNT(*) AS n FROM invoices
        WHERE 1=1${invoiceScope.sql} GROUP BY period,status ORDER BY period DESC LIMIT 10`,invoiceScope.bindings);
      chunks.push({source:'db',id:'invoices',text:`Invoices: ${JSON.stringify(rows)}`});
    }
    if (/payroll|gaji|net|gross|periode/.test(q)) {
      const submissionScope=scope(actor,'s.client_id');
      const rows=await d1All(env.DB,`SELECT s.period,s.state AS status,s.client_id,
        COALESCE((SELECT SUM(ec.imported_net) FROM employees e JOIN employee_compensation ec ON ec.employee_id=e.id
          WHERE e.client_id=s.client_id AND (s.project_id IS NULL OR e.project_id=s.project_id) AND ec.payroll_source_period=s.period),0) AS total_net,
        COALESCE((SELECT COUNT(*) FROM employees e JOIN employee_compensation ec ON ec.employee_id=e.id
          WHERE e.client_id=s.client_id AND (s.project_id IS NULL OR e.project_id=s.project_id) AND ec.payroll_source_period=s.period),0) AS employee_count
        FROM payroll_submissions s WHERE 1=1${submissionScope.sql} ORDER BY s.period DESC,s.created_at DESC LIMIT 8`,submissionScope.bindings);
      chunks.push({source:'db',id:'payrolls',text:`Payroll submissions: ${JSON.stringify(rows)}`});
    }
    const name=userText.match(/(?:karyawan|pegawai|nrk|cari)\s+([A-Za-z. ]{3,40})/i);
    if (name) {
      const key=`%${name[1].trim()}%`;
      const rows=await d1All(env.DB,`SELECT id,name,status_aktif,province,branch_id FROM employees
        WHERE (name LIKE ? COLLATE NOCASE OR id LIKE ? COLLATE NOCASE)${employeeScope.sql} LIMIT 8`,[key,key,...employeeScope.bindings]);
      if(rows.length) chunks.push({source:'db',id:'emp-search',text:`Hasil cari: ${JSON.stringify(rows)}`});
    }
    const employeeCount=await d1First(env.DB,`SELECT COUNT(*) AS n FROM employees WHERE 1=1${employeeScope.sql}`,employeeScope.bindings);
    const clients=await d1First(env.DB,`SELECT COUNT(*) AS n FROM clients WHERE 1=1${clientScope.sql}`,clientScope.bindings);
    chunks.push({source:'db',id:'snapshot',text:`Snapshot D1: ${employeeCount?.n||0} employees, ${clients?.n||0} clients.`});
  } catch { chunks.push({source:'system',text:'RAG D1 sementara tidak tersedia.'}); }
  return chunks.slice(0,limit);
}

export async function loadMemory(env,sessionId,limit=12) {
  if (!hasD1(env)||!sessionId) return [];
  try { return (await d1All(env.DB,'SELECT role,content FROM ida_messages WHERE session_id=? ORDER BY created_at DESC LIMIT ?',[sessionId,limit])).reverse(); }
  catch { return []; }
}
export async function saveMemory(env,sessionId,role,content) {
  if (!hasD1(env)||!sessionId||!content) return;
  try {
    const operations=[{statement:'INSERT INTO ida_messages(id,session_id,role,content) VALUES(?,?,?,?)',bindings:[`MSG-${crypto.randomUUID()}`,sessionId,role,String(content).slice(0,4000)]}];
    if(role==='user'&&/ingat|remember|preferensi|saya ingin/i.test(content)) operations.push({statement:'INSERT INTO ida_memories(id,session_id,fact) VALUES(?,?,?)',bindings:[`FACT-${crypto.randomUUID()}`,sessionId,String(content).slice(0,500)]});
    await d1Batch(env.DB,operations);
  } catch { /* memory is non-critical */ }
}
export async function loadFacts(env,sessionId,limit=8) {
  if (!hasD1(env)) return [];
  try { return (await d1All(env.DB,'SELECT fact FROM ida_memories WHERE session_id=? OR session_id IS NULL ORDER BY created_at DESC LIMIT ?',[sessionId,limit])).map((row)=>row.fact); }
  catch { return []; }
}

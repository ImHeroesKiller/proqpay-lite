import { neon } from '@neondatabase/serverless';

function getUrl(env) {
  return env.DATABASE_URL || env.NEON_DATABASE_URL || env.POSTGRES_URL || null;
}

const KNOWLEDGE = [
  {
    id: 'flow-payroll',
    tags: ['payroll', 'hitung', 'approval', 'payment', 'alur', 'flow'],
    text: 'Alur payroll ProQPay: DRAFT → CALCULATED (hitung payroll) → APPROVED (ajukan approval) → PAYMENT_INSTRUCTION (buat payment instruction) → PAID. Dashboard visualisasi; aksi utama lewat IDA.',
  },
  {
    id: 'margin',
    tags: ['margin', 'laba', 'profit', 'invoice', 'revenue'],
    text: 'Margin outsourcing = total invoice ke client − total payroll net. Service fee default estimasi Rp1.5jt/karyawan + BPJS fee + admin + PPN 10% bila invoice belum terbit.',
  },
  {
    id: 'umr',
    tags: ['umr', 'umk', 'gaji minimum', 'upah'],
    text: 'UMR dipakai per kota/provinsi penempatan. Mapping lokasi→provinsi via modul wilayah IDA. Contoh 2025: DKI 5.396.761, Jabar 2.049.324, Jatim 2.246.100, Sumut ikut cabang Medan.',
  },
  {
    id: 'import',
    tags: ['import', 'excel', 'upload', 'hris', 'iap'],
    text: 'Import HRIS: upload xlsx di dashboard → parse kolom IAP → identifyProvince(lokasi,cabang,kotaUMK) → POST /api/import ke Neon (employees + related tables).',
  },
  {
    id: 'bpjs-pph',
    tags: ['bpjs', 'pph', 'potongan', 'pajak'],
    text: 'Potongan karyawan tipikal: BPJS Kesehatan 1% employee, BPJS TK 2% employee, PPh21 progresif (estimasi TER sederhana di engine lokal).',
  },
  {
    id: 'status-karyawan',
    tags: ['kontrak', 'berhenti', 'pkwt', 'status'],
    text: 'Status dari HRIS: Kontrak, Kontrak selesai, Berhenti atas permintaan sendiri, dll. Filter aktif biasanya Status Pegawai = Kontrak.',
  },
];

function scoreDoc(q, doc) {
  const t = q.toLowerCase();
  let s = 0;
  for (const tag of doc.tags) if (t.includes(tag)) s += 2;
  for (const w of t.split(/\s+/)) if (w.length > 3 && doc.text.toLowerCase().includes(w)) s += 1;
  return s;
}

export async function retrieveRag(env, userText, limit = 6) {
  const q = (userText || '').toLowerCase();
  const chunks = [];

  // 1) Knowledge base
  const docs = KNOWLEDGE.map((d) => ({ ...d, score: scoreDoc(q, d) }))
    .filter((d) => d.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
  for (const d of docs) chunks.push({ source: 'knowledge', id: d.id, text: d.text });

  // 2) Neon live data
  const url = getUrl(env);
  if (!url) {
    chunks.push({ source: 'system', text: 'DATABASE_URL belum terhubung — RAG DB offline.' });
    return chunks.slice(0, limit);
  }

  try {
    const sql = neon(url);

    if (/karyawan|pegawai|employee|nrk|berapa orang|headcount/.test(q)) {
      const stats = await sql`
        SELECT status_aktif, province, COUNT(*)::int AS n
        FROM employees
        GROUP BY status_aktif, province
        ORDER BY n DESC
        LIMIT 20
      `;
      const total = await sql`SELECT COUNT(*)::int AS n FROM employees`;
      chunks.push({
        source: 'db',
        id: 'emp-stats',
        text: `DB employees total=${total[0]?.n || 0}. Breakdown: ${JSON.stringify(stats).slice(0, 900)}`,
      });
    }

    if (/provinsi|wilayah|cabang|lokasi|medan|denpasar|bandung|map/.test(q)) {
      const byProv = await sql`
        SELECT province, COUNT(*)::int AS n
        FROM employees
        WHERE province IS NOT NULL
        GROUP BY province
        ORDER BY n DESC
        LIMIT 15
      `;
      chunks.push({
        source: 'db',
        id: 'by-province',
        text: `Karyawan per provinsi: ${JSON.stringify(byProv)}`,
      });
    }

    if (/margin|invoice|laba|revenue|outstanding|ar |piutang/.test(q)) {
      const inv = await sql`
        SELECT period, status, SUM(total_amount)::bigint AS total, COUNT(*)::int AS n
        FROM invoices GROUP BY period, status ORDER BY period DESC LIMIT 10
      `;
      chunks.push({ source: 'db', id: 'invoices', text: `Invoices: ${JSON.stringify(inv)}` });
    }

    if (/payroll|gaji|net|gross|periode/.test(q)) {
      const pays = await sql`
        SELECT period, status, total_net, total_gross, employee_count
        FROM payrolls ORDER BY period DESC LIMIT 8
      `;
      chunks.push({ source: 'db', id: 'payrolls', text: `Payrolls: ${JSON.stringify(pays)}` });
    }

    // name search
    const nameMatch = userText.match(/(?:karyawan|pegawai|nrk|cari)\s+([A-Za-z. ]{3,40})/i);
    if (nameMatch) {
      const key = `%${nameMatch[1].trim()}%`;
      const found = await sql`
        SELECT id, name, status_aktif, province, branch_id
        FROM employees
        WHERE name ILIKE ${key} OR id ILIKE ${key}
        LIMIT 8
      `;
      if (found.length) {
        chunks.push({ source: 'db', id: 'emp-search', text: `Hasil cari: ${JSON.stringify(found)}` });
      }
    }

    // always small org snapshot
    const snap = await sql`SELECT COUNT(*)::int AS emp FROM employees`;
    const cli = await sql`SELECT COUNT(*)::int AS n FROM clients`;
    chunks.push({
      source: 'db',
      id: 'snapshot',
      text: `Snapshot Neon: ${snap[0]?.emp || 0} employees, ${cli[0]?.n || 0} clients.`,
    });
  } catch (err) {
    chunks.push({ source: 'system', text: `RAG DB error: ${err?.message || String(err)}` });
  }

  return chunks.slice(0, limit);
}

export async function loadMemory(env, sessionId, limit = 12) {
  const url = getUrl(env);
  if (!url || !sessionId) return [];
  try {
    const sql = neon(url);
    await sql.query(`CREATE TABLE IF NOT EXISTS ida_messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
    await sql.query(`CREATE TABLE IF NOT EXISTS ida_memories (
      id TEXT PRIMARY KEY,
      session_id TEXT,
      fact TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
    const rows = await sql`
      SELECT role, content FROM ida_messages
      WHERE session_id = ${sessionId}
      ORDER BY created_at DESC LIMIT ${limit}
    `;
    return rows.reverse();
  } catch {
    return [];
  }
}

export async function saveMemory(env, sessionId, role, content) {
  const url = getUrl(env);
  if (!url || !sessionId || !content) return;
  try {
    const sql = neon(url);
    const id = `MSG-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await sql`
      INSERT INTO ida_messages (id, session_id, role, content)
      VALUES (${id}, ${sessionId}, ${role}, ${String(content).slice(0, 4000)})
    `;
    // extract simple long-term facts
    if (role === 'user' && /ingat|remember|preferensi|saya ingin/i.test(content)) {
      const fid = `FACT-${Date.now()}`;
      await sql`
        INSERT INTO ida_memories (id, session_id, fact)
        VALUES (${fid}, ${sessionId}, ${String(content).slice(0, 500)})
      `;
    }
  } catch {
    /* ignore */
  }
}

export async function loadFacts(env, sessionId, limit = 8) {
  const url = getUrl(env);
  if (!url) return [];
  try {
    const sql = neon(url);
    const rows = await sql`
      SELECT fact FROM ida_memories
      WHERE session_id = ${sessionId} OR session_id IS NULL
      ORDER BY created_at DESC LIMIT ${limit}
    `;
    return rows.map((r) => r.fact);
  } catch {
    return [];
  }
}

'use client';

import { useCallback, useEffect, useState } from 'react';
import { executeOperatingAction, listOperatingResource, type OperatingResource } from '@/lib/operating-model-api';
import { formatIDR } from '@/lib/format';

type Tab = 'submissions' | 'exceptions' | 'payments' | 'integrations';
type Actor = { email: string; role: string; permissions?: string[] };

const labels: Record<Tab, string> = {
  submissions: 'Payroll Workspace',
  exceptions: 'Exception Center',
  payments: 'Payment & Rekonsiliasi',
  integrations: 'Integrasi',
};

const stateTone = (state: string) => state.includes('EXCEPTION') || state.includes('REJECT') ? '#dc2626'
  : state.includes('APPROVED') || state === 'COMPLETED' || state === 'MATCHED' ? '#059669' : '#4f46e5';

export default function OperatingWorkspace() {
  const [tab, setTab] = useState<Tab>('submissions');
  const [actor, setActor] = useState<Actor | null>(null);
  const [data, setData] = useState<Record<string, any[]>>({});
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setMessage('');
    try {
      const resources: OperatingResource[] = ['submissions','exceptions','payment-instructions','payment-proofs','reconciliations','integrations'];
      const [me, ...results] = await Promise.all([
        fetch('/api/me').then((r) => r.json()),
        ...resources.map((resource) => listOperatingResource(resource)),
      ]);
      setActor(me.user || null);
      const merged: Record<string, any[]> = {};
      results.forEach((result: any) => Object.entries(result).forEach(([key, value]) => {
        if (Array.isArray(value)) merged[key] = value;
      }));
      setData(merged);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Gagal memuat workspace');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function act(payload: Record<string, unknown>, success: string) {
    setMessage('Memproses…');
    try {
      if (Object.keys(payload).length) await executeOperatingAction(payload);
      setMessage(success);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Aksi gagal');
    }
  }

  const role = actor?.role || 'UNKNOWN';
  const isProcessor = ['SUPER_ADMIN','PAYROLL_PROCESSOR'].includes(role);
  const isController = ['SUPER_ADMIN','PAYROLL_CONTROLLER'].includes(role);
  const isClient = role === 'CLIENT_USER';
  const canApprovePayment = actor?.permissions?.includes('payment:approve') || false;

  return (
    <section>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ fontSize: 22, fontWeight: 720, margin: 0 }}>Payroll Operations</h2>
          <p style={{ color: 'var(--text3)', fontSize: 13, marginTop: 5 }}>Controlled workflow dari submission sampai rekonsiliasi.</p>
        </div>
        <div className="card" style={{ padding: '8px 12px', fontSize: 12 }}>
          <strong>{actor?.email || 'Memuat pengguna…'}</strong>
          <span style={{ color: 'var(--text3)', marginLeft: 8 }}>{role.replaceAll('_', ' ')}</span>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, margin: '18px 0', overflowX: 'auto' }}>
        {(Object.keys(labels) as Tab[]).map((item) => (
          <button key={item} type="button" onClick={() => setTab(item)} style={tabButton(tab === item)}>{labels[item]}</button>
        ))}
      </div>

      {message && <div style={{ padding: '10px 13px', borderRadius: 10, marginBottom: 14, background: 'var(--accent-soft)', color: 'var(--text2)', fontSize: 13 }}>{message}</div>}
      {loading ? <Empty title="Memuat data operasional…" /> : (
        <>
          {tab === 'submissions' && <Submissions rows={data.submissions || []} role={role} act={act} />}
          {tab === 'exceptions' && <Exceptions rows={data.exceptions || []} role={role} canResolve={isProcessor || isController || isClient} act={act} />}
          {tab === 'payments' && <Payments instructions={data.paymentInstructions || []} proofs={data.paymentProofs || []} reconciliations={data.reconciliations || []} canReview={isController} canApprove={canApprovePayment} act={act} />}
          {tab === 'integrations' && <Integrations rows={data.integrations || []} canCreate={isProcessor} />}
        </>
      )}
    </section>
  );
}

function Submissions({ rows, role, act }: { rows: any[]; role: string; act: (p: Record<string, unknown>, s: string) => Promise<void> }) {
  if (!rows.length) return <Empty title="Belum ada payroll submission" detail="Submission baru akan tampil setelah service plan klien aktif dan data periode dikirim." />;
  const processorNext: Record<string, string> = { DRAFT:'SUBMITTED', SUBMITTED:'INGESTING', INGESTING:'AI_VALIDATING', AI_VALIDATING:'VALIDATED', EXCEPTION_FOUND:'CLIENT_ACTION_REQUIRED', CLIENT_RESUBMITTED:'AI_VALIDATING', VALIDATED:'STANDARDIZED', STANDARDIZED:'CONTROLLER_REVIEW', REVISION_REQUIRED:'AI_VALIDATING' };
  const controllerNext: Record<string, string> = { CONTROLLER_REVIEW:'DATA_APPROVED', DATA_APPROVED:'PAYROLL_FINALIZED', PAYROLL_FINALIZED:'PAYMENT_INSTRUCTION_READY' };
  const clientNext: Record<string, string> = { DRAFT:'SUBMITTED', CLIENT_ACTION_REQUIRED:'CLIENT_RESUBMITTED' };
  return <CardTable headers={['ID / Periode','Tier','Status','Dibuat','Aksi']} rows={rows.map((r) => [
    <div key="id"><strong>{r.id}</strong><small style={small}>{r.period} · {r.client_id}</small></div>,
    String(r.service_tier || '-').replace('TIER_','Tier ').replaceAll('_',' '),
    <Badge key="state" text={r.state} />,
    date(r.created_at),
    (() => {
      const next = role === 'CLIENT_USER' ? clientNext[r.state]
        : ['SUPER_ADMIN','PAYROLL_CONTROLLER'].includes(role) && controllerNext[r.state]
          ? controllerNext[r.state] : processorNext[r.state];
      return next ? <button key="action" style={actionButton} onClick={() => void act({ action:'TRANSITION_SUBMISSION', submissionId:r.id, toState:next }, `Status diperbarui ke ${next}`)}>Lanjutkan</button> : <span key="none" style={small}>Tidak ada aksi</span>;
    })(),
  ])} />;
}

function Exceptions({ rows, role, canResolve, act }: { rows: any[]; role: string; canResolve: boolean; act: (p: Record<string, unknown>, s: string) => Promise<void> }) {
  const [severity, setSeverity] = useState('ALL');
  const [status, setStatus] = useState('OPEN');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<any | null>(null);
  const filtered = rows.filter((row) => (severity === 'ALL' || row.severity === severity)
    && (status === 'ALL' || row.status === status)
    && (!query || [row.category,row.employee_id,row.reason,row.client_name,row.project_name].join(' ').toLowerCase().includes(query.toLowerCase())));
  const pageCount = Math.max(1, Math.ceil(filtered.length / 20));
  const visible = filtered.slice((page - 1) * 20, page * 20);
  if (!rows.length) return <Empty title="Tidak ada exception operasional" detail="Temuan validasi akan masuk ke antrean ini dan diblokir berdasarkan tingkat severity." />;
  return <div style={{display:'grid',gap:12}}>
    <div className="card" style={{padding:12,display:'flex',gap:8,flexWrap:'wrap'}}>
      <input style={{...input,flex:'1 1 220px'}} value={query} placeholder="Cari karyawan, temuan, klien…" onChange={(e)=>{setQuery(e.target.value);setPage(1);}} />
      <select style={input} value={severity} onChange={(e)=>{setSeverity(e.target.value);setPage(1);}}><option value="ALL">Semua severity</option><option>CRITICAL</option><option>WARNING</option><option>INFO</option></select>
      <select style={input} value={status} onChange={(e)=>{setStatus(e.target.value);setPage(1);}}><option value="ALL">Semua status</option><option>OPEN</option><option>CLIENT_ACTION_REQUIRED</option><option>RESOLVED</option><option>ACCEPTED</option></select>
      <span style={{...small,margin:'auto 0'}}><strong>{filtered.length}</strong> temuan</span>
    </div>
    <CardTable headers={['Temuan','Klien / Project','Severity','Status','Aksi']} rows={visible.map((r) => [
      <div key="finding"><strong>{r.category}</strong><small style={small}>{r.employee_id || 'Submission'} · {r.reason || r.field || '-'}</small></div>,
      <div key="scope"><strong>{r.client_name || r.client_id || '-'}</strong><small style={small}>{r.project_name || r.period || '-'}</small></div>,
      <Badge key="severity" text={r.severity} />,
      <Badge key="status" text={r.status} />,
      <button key="detail" style={actionButton} onClick={() => setSelected(r)}>Tindak lanjut</button>,
    ])} />
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}><span style={small}>Halaman {Math.min(page,pageCount)} dari {pageCount}</span><div style={{display:'flex',gap:6}}><button className="btn" disabled={page<=1} onClick={()=>setPage(p=>p-1)}>←</button><button className="btn" disabled={page>=pageCount} onClick={()=>setPage(p=>p+1)}>→</button></div></div>
    {selected ? <div className="directory-modal-backdrop" onMouseDown={(e)=>{if(e.target===e.currentTarget)setSelected(null);}}><div className="directory-modal" role="dialog" aria-modal="true">
      <div className="directory-modal-title"><div><span>EXCEPTION CENTER</span><h3>{selected.category}</h3></div><button onClick={()=>setSelected(null)}>✕</button></div>
      <p><strong>{selected.employee_id || 'Submission'}</strong> · {selected.client_name || selected.client_id}</p><p style={{color:'var(--text2)',fontSize:13}}>{selected.reason}</p>
      <div style={{display:'flex',gap:8,flexWrap:'wrap',marginTop:16}}>
        {['SUPER_ADMIN','PAYROLL_PROCESSOR'].includes(role) && !['RESOLVED','ACCEPTED'].includes(selected.status) ? <button className="btn btn-primary" onClick={()=>{const message=window.prompt('Instruksi perbaikan untuk user klien:',selected.reason||'Mohon lengkapi dan validasi data ini.');if(message)void act({action:'REQUEST_CLIENT_ACTION',exceptionId:selected.id,message},'Permintaan perbaikan dikirim ke user klien').then(()=>setSelected(null));}}>Minta perbaikan klien</button> : null}
        <button className="btn" onClick={()=>{const message=window.prompt('Tulis pesan pada temuan:');if(message)void act({action:'ADD_EXCEPTION_NOTE',exceptionId:selected.id,message},'Pesan tersimpan pada temuan').then(()=>setSelected(null));}}>Chat / catatan</button>
        {selected.client_email ? <a className="btn" href={`mailto:${encodeURIComponent(selected.client_email)}?subject=${encodeURIComponent(`Perbaikan data payroll ${selected.period || ''}`)}&body=${encodeURIComponent(selected.reason || '')}`}>Email klien</a> : <span style={small}>Email akun klien belum dipasangkan</span>}
        {canResolve && !['RESOLVED','ACCEPTED'].includes(selected.status) ? <button className="btn" onClick={()=>void act({action:'RESOLVE_EXCEPTION',exceptionId:selected.id,status:role==='CLIENT_USER'?'ACCEPTED':'RESOLVED',resolutionNote:role==='CLIENT_USER'?'Data telah diperbaiki/dikonfirmasi oleh user klien':'Diverifikasi dan diselesaikan'},'Exception diperbarui').then(()=>setSelected(null))}>{role==='CLIENT_USER'?'Konfirmasi sudah diperbaiki':'Tandai selesai'}</button> : null}
      </div>
      {selected.resolution_note ? <div className="directory-message" style={{marginTop:14,whiteSpace:'pre-wrap'}}>{selected.resolution_note}</div> : null}
    </div></div> : null}
  </div>;
}

function Payments({ instructions, proofs, reconciliations, canReview, canApprove, act }: { instructions:any[]; proofs:any[]; reconciliations:any[]; canReview:boolean; canApprove:boolean; act:(p:Record<string,unknown>,s:string)=>Promise<void> }) {
  const [proofFor, setProofFor] = useState<string | null>(null);
  const [proof, setProof] = useState({ bank:'BCA', reference:'', transactionDate:new Date().toISOString().slice(0,10), amount:'' });
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  if (!instructions.length) return <Empty title="Belum ada payment instruction" detail="Payment instruction akan tersedia setelah payroll selesai divalidasi dan disetujui." />;
  return <div style={{ display:'grid', gap:16 }}>
    <CardTable headers={['Instruction','Nilai','Status','Dibuat','Aksi']} rows={instructions.map((r) => {
      let action: React.ReactNode = <span style={small}>Menunggu tahap berikutnya</span>;
      if (r.status === 'PAYMENT_APPROVAL_PENDING') action = canApprove
        ? <button style={actionButton} onClick={() => void act({ action:'APPROVE_PAYMENT', paymentInstructionId:r.id, actionHash:`approve-${r.id}`, confirmation:'KONFIRMASI PAYMENT' }, 'Payment disetujui')}>Approve</button>
        : <span style={small}>Menunggu PAYMENT_APPROVER</span>;
      if (canReview && ['APPROVED_FOR_PAYMENT','DISBURSEMENT_PROCESSING'].includes(r.status)) action = <button style={actionButton} onClick={() => { setProofFor(r.id); setProof((p) => ({ ...p, amount:String(r.expected_total || '') })); }}>Catat Bukti</button>;
      if (canReview && r.status === 'PROOF_UPLOADED') action = <button style={actionButton} onClick={() => void act({ action:'RECONCILE_PAYMENT', paymentInstructionId:r.id }, 'Rekonsiliasi selesai')}>Rekonsiliasi</button>;
      return [<strong key="id">{r.id}</strong>, formatIDR(Number(r.expected_total || 0)), <Badge key="status" text={r.status} />, date(r.created_at), <span key="action">{action}</span>];
    })} />
    {proofFor && <div className="card" style={{ padding:18 }}>
      <div style={{ display:'flex', justifyContent:'space-between', gap:12 }}><strong>Bukti Pembayaran · {proofFor}</strong><button type="button" onClick={() => setProofFor(null)} style={{ border:0, background:'transparent', cursor:'pointer' }}>✕</button></div>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(160px,1fr))', gap:10, marginTop:14 }}>
        <select aria-label="Bank" value={proof.bank} onChange={(e) => setProof({ ...proof, bank:e.target.value })} style={input}><option>BCA</option><option>Mandiri</option><option>BRI</option><option>BNI</option><option>Lainnya</option></select>
        <input aria-label="Referensi bank" placeholder="Referensi bank" value={proof.reference} onChange={(e) => setProof({ ...proof, reference:e.target.value })} style={input} />
        <input aria-label="Tanggal transaksi" type="date" value={proof.transactionDate} onChange={(e) => setProof({ ...proof, transactionDate:e.target.value })} style={input} />
        <input aria-label="Nominal bukti" type="number" placeholder="Nominal" value={proof.amount} onChange={(e) => setProof({ ...proof, amount:e.target.value })} style={input} />
      </div>
      <input aria-label="File bukti pembayaran" type="file" accept="application/pdf,image/jpeg,image/png" onChange={(e) => setFile(e.target.files?.[0] || null)} style={{ ...input, marginTop:10, width:'100%' }} />
      <p style={{ ...small, margin:'8px 0 10px' }}>{file ? `${file.name} · ${(file.size / 1024).toFixed(1)} KB` : 'PDF, JPG, atau PNG · maksimal 5 MB · tersimpan private di R2'}</p>
      {uploadError && <p style={{ color:'#dc2626', fontSize:12 }}>{uploadError}</p>}
      <button style={actionButton} disabled={uploading || !file || !proof.reference || !Number(proof.amount)} onClick={() => { setUploadError(''); void uploadProof(proofFor, proof, file, setUploading, () => { setProofFor(null); setFile(null); void act({}, 'Bukti pembayaran tersimpan di R2'); }).catch((error) => setUploadError(error instanceof Error ? error.message : 'Upload gagal')); }}>{uploading ? 'Mengunggah…' : 'Upload Bukti'}</button>
    </div>}
    <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(260px,1fr))', gap:14 }}>
      <div className="card" style={{ padding:18 }}><span style={small}>Bukti Pembayaran</span><div style={{ fontSize:26, fontWeight:750, margin:'6px 0' }}>{proofs.length}</div>{proofs.length ? <a style={{ ...actionButton, display:'inline-block', textDecoration:'none', background:'var(--bg-subtle)', color:'var(--accent)' }} href={`/api/payment-proof?id=${encodeURIComponent(proofs[0].id)}`} target="_blank" rel="noreferrer">Unduh bukti terbaru</a> : <span style={small}>Belum ada bukti</span>}</div>
      <Summary title="Rekonsiliasi" value={reconciliations.length} note={reconciliations.length ? `${reconciliations[0].status} · Selisih ${formatIDR(Number(reconciliations[0].difference || 0))}` : 'Belum direkonsiliasi'} />
    </div>
  </div>;
}

async function uploadProof(paymentInstructionId:string, proof:{bank:string;reference:string;transactionDate:string;amount:string}, file:File | null, setUploading:(value:boolean)=>void, done:()=>void) {
  if (!file) return;
  setUploading(true);
  try {
    const form = new FormData();
    form.set('paymentInstructionId', paymentInstructionId);
    form.set('bank', proof.bank);
    form.set('reference', proof.reference);
    form.set('transactionDate', proof.transactionDate);
    form.set('amount', proof.amount);
    form.set('file', file);
    const response = await fetch('/api/payment-proof', { method:'POST', body:form });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
    done();
  } finally {
    setUploading(false);
  }
}

function Integrations({ rows, canCreate }: { rows:any[]; canCreate:boolean }) {
  return <div style={{ display:'grid', gap:14 }}>
    <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(190px,1fr))', gap:12 }}>
      {['HRIS','ATTENDANCE','ACCOUNTING','BANK'].map((type) => {
        const connection = rows.find((r) => r.connector_type === type);
        return <div key={type} className="card" style={{ padding:18 }}><strong>{type === 'ATTENDANCE' ? 'Attendance' : type}</strong><p style={{ ...small, margin:'8px 0 0' }}>{connection ? `Status: ${connection.status}` : 'Belum terhubung'}</p></div>;
      })}
    </div>
    {!rows.length && <Empty title="Belum ada koneksi integrasi" detail={canCreate ? 'Koneksi dibuat setelah service plan Tier 3 aktif. Kredensial tidak pernah ditampilkan di UI.' : 'Hubungi Payroll Processor untuk mengaktifkan koneksi.'} />}
  </div>;
}

function CardTable({ headers, rows }: { headers:string[]; rows:React.ReactNode[][] }) { return <div className="card" style={{ overflowX:'auto' }}><table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}><thead><tr>{headers.map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead><tbody>{rows.map((row,i) => <tr key={i} style={{ borderBottom:'1px solid var(--border-soft)' }}>{row.map((cell,j) => <td key={j} style={td}>{cell}</td>)}</tr>)}</tbody></table></div>; }
function Empty({ title, detail }: { title:string; detail?:string }) { return <div className="card" style={{ padding:'34px 24px', textAlign:'center' }}><strong>{title}</strong>{detail && <p style={{ color:'var(--text3)', fontSize:13, margin:'8px auto 0', maxWidth:520 }}>{detail}</p>}</div>; }
function Summary({ title,value,note }: { title:string; value:number; note:string }) { return <div className="card" style={{ padding:18 }}><span style={small}>{title}</span><div style={{ fontSize:26, fontWeight:750, margin:'6px 0' }}>{value}</div><span style={small}>{note}</span></div>; }
function Badge({ text }: { text:string }) { return <span style={{ display:'inline-block', color:stateTone(text), background:`${stateTone(text)}14`, borderRadius:999, padding:'4px 9px', fontWeight:700, fontSize:10 }}>{text.replaceAll('_',' ')}</span>; }
const date = (value:string) => value ? new Date(value).toLocaleDateString('id-ID') : '-';
const small: React.CSSProperties = { display:'block', color:'var(--text3)', fontSize:11, marginTop:3 };
const th: React.CSSProperties = { textAlign:'left', padding:'11px 14px', background:'var(--bg-subtle)', color:'var(--text2)', fontSize:10.5, textTransform:'uppercase', whiteSpace:'nowrap' };
const td: React.CSSProperties = { padding:'12px 14px', verticalAlign:'middle' };
const actionButton: React.CSSProperties = { border:0, borderRadius:8, background:'var(--accent)', color:'#fff', padding:'7px 11px', fontSize:11, fontWeight:650, cursor:'pointer', whiteSpace:'nowrap' };
const input: React.CSSProperties = { border:'1px solid var(--border)', borderRadius:8, background:'var(--bg-surface)', color:'var(--text)', padding:'9px 10px', fontSize:12, minWidth:0 };
const tabButton = (active:boolean):React.CSSProperties => ({ border:`1px solid ${active ? 'var(--accent)' : 'var(--border)'}`, borderRadius:9, background:active ? 'var(--accent-soft)' : 'var(--bg-surface)', color:active ? 'var(--accent)' : 'var(--text2)', padding:'9px 12px', fontSize:12, fontWeight:650, cursor:'pointer', whiteSpace:'nowrap' });

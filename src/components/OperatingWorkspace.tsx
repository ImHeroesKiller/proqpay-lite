'use client';

import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { executeOperatingAction, getPaymentInstructionDetail, listOperatingResource, type OperatingResource } from '@/lib/operating-model-api';
import { formatIDR } from '@/lib/format';
import BillingWorkspace from '@/components/BillingWorkspace';

type Tab = 'submissions' | 'exceptions' | 'payments' | 'billing' | 'integrations';
type Actor = { email: string; role: string; permissions?: string[]; clientIds?: string[]; projectIds?: string[] };

const labels: Record<Tab, string> = {
  submissions: 'Payroll Workspace',
  exceptions: 'Exception Center',
  payments: 'Payment & Rekonsiliasi',
  billing: 'Billing & AR',
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
      const meResponse = await fetch('/api/me');
      const me = await meResponse.json();
      if (!meResponse.ok) throw new Error(me.error || `HTTP ${meResponse.status}`);
      setActor(me.user || null);
      const clientIds = me.user?.role === 'CLIENT_USER' ? (me.user.clientIds || []) : [undefined];
      const results = await Promise.all(clientIds.flatMap((clientId: string | undefined) => resources.map((resource) => listOperatingResource(resource, clientId))));
      const merged: Record<string, any[]> = {};
      results.forEach((result: any) => Object.entries(result).forEach(([key, value]) => {
        if (Array.isArray(value)) merged[key] = [...(merged[key] || []), ...value];
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
      await load();
      setMessage(success);
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
          <h2 style={{ fontSize: 22, fontWeight: 720, margin: 0 }}>Operations Center</h2>
          <p style={{ color: 'var(--text3)', fontSize: 13, marginTop: 5 }}>Controlled workflow dari submission, payment, sampai invoice dan AR.</p>
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

      {message && <div className={`app-notice-bubble ${/gagal|error|tidak|unavailable|belum siap|invalid/i.test(message) ? 'app-notice-error' : 'app-notice-info'}`} role="status"><strong>{/gagal|error|tidak|unavailable|belum siap|invalid/i.test(message) ? 'Perlu perhatian' : 'Informasi'}</strong><span>{message}</span><button type="button" aria-label="Tutup pesan" onClick={() => setMessage('')}>✕</button></div>}
      {loading ? <Empty title="Memuat data operasional…" /> : (
        <>
          {tab === 'submissions' && <Submissions rows={data.submissions || []} role={role} act={act} />}
          {tab === 'exceptions' && <Exceptions rows={data.exceptions || []} role={role} canResolve={isProcessor || isController || isClient} act={act} />}
          {tab === 'payments' && <Payments instructions={data.paymentInstructions || []} proofs={data.paymentProofs || []} reconciliations={data.reconciliations || []} canReview={isController} canApprove={canApprovePayment} act={act} />}
          {tab === 'billing' && <BillingWorkspace actor={actor} />}
          {tab === 'integrations' && <Integrations rows={data.integrations || []} canCreate={isProcessor} />}
        </>
      )}
    </section>
  );
}

function Submissions({ rows, role, act }: { rows: any[]; role: string; act: (p: Record<string, unknown>, s: string) => Promise<void> }) {
  const [selected, setSelected] = useState<any | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [reviewNote, setReviewNote] = useState('');
  const [paymentPeriod, setPaymentPeriod] = useState('');
  const [arrearsText, setArrearsText] = useState('');
  if (!rows.length) return <Empty title="Belum ada payroll submission" detail="Submission baru akan tampil setelah service plan klien aktif dan data periode dikirim." />;
  const processorNext: Record<string, string> = { DRAFT:'SUBMITTED', SUBMITTED:'INGESTING', INGESTING:'AI_VALIDATING', AI_VALIDATING:'VALIDATED', EXCEPTION_FOUND:'CLIENT_ACTION_REQUIRED', CLIENT_RESUBMITTED:'AI_VALIDATING', VALIDATED:'STANDARDIZED', STANDARDIZED:'CONTROLLER_REVIEW', REVISION_REQUIRED:'AI_VALIDATING' };
  const controllerNext: Record<string, string> = { CONTROLLER_REVIEW:'DATA_APPROVED', DATA_APPROVED:'PAYROLL_FINALIZED', PAYROLL_FINALIZED:'PAYMENT_INSTRUCTION_READY' };
  const clientNext: Record<string, string> = { DRAFT:'SUBMITTED', CLIENT_ACTION_REQUIRED:'CLIENT_RESUBMITTED' };
  function nextFor(row:any) {
    if (role === 'CLIENT_USER') return clientNext[row.state];
    if (['SUPER_ADMIN','PAYROLL_CONTROLLER'].includes(role) && controllerNext[row.state]) {
      return row.service_tier === 'TIER_1_PAYMENT_PROCESSING' && row.state === 'DATA_APPROVED' ? 'PAYMENT_INSTRUCTION_READY' : controllerNext[row.state];
    }
    if (['SUPER_ADMIN','PAYROLL_CONTROLLER'].includes(role) && row.state === 'PAYMENT_INSTRUCTION_READY') return 'GENERATE_PAYMENT_INSTRUCTION';
    const next = processorNext[row.state];
    return row.service_tier === 'TIER_1_PAYMENT_PROCESSING' && row.state === 'SUBMITTED' ? 'AI_VALIDATING' : next;
  }
  function openReview(row:any) {
    setSelected(row); setConfirmed(false); setReviewNote('');
    setPaymentPeriod(row.payment_period || row.period || '');
    setArrearsText(Array.isArray(row.arrears_periods) ? row.arrears_periods.join(', ') : '');
  }
  const actionName = (state:string) => ({ DRAFT:'Review & submit', SUBMITTED:'Periksa submission', INGESTING:'Mulai validasi', AI_VALIDATING:'Review validasi', EXCEPTION_FOUND:'Minta perbaikan klien', VALIDATED:'Standardisasi data', STANDARDIZED:'Review akhir Processor', CONTROLLER_REVIEW:'Review Controller', DATA_APPROVED:'Siapkan payment', PAYROLL_FINALIZED:'Siapkan payment', PAYMENT_INSTRUCTION_READY:'Buat payment instruction', CLIENT_ACTION_REQUIRED:'Kirim perbaikan' }[state] || 'Lihat detail');
  const table = <CardTable headers={['Klien / Periode','Tier','Status','Ringkasan','Aksi']} rows={rows.map((r) => [
    <div key="id"><strong>{r.client_name || r.client_id}</strong><small style={small}>Payroll {r.period} · Bayar {r.payment_period || r.period}</small><small style={small}>{r.project_name || r.id}</small></div>,
    String(r.service_tier || '-').replace('TIER_','Tier ').replaceAll('_',' '),
    <Badge key="state" text={r.state} />,
    <div key="summary"><strong>{Number(r.employee_count || 0)} karyawan</strong><small style={small}>{formatIDR(Number(r.total_net || 0))} · {Number(r.blocking_count || 0)} blocker</small></div>,
    (() => {
      const next = nextFor(r);
      return <button key="action" style={actionButton} onClick={() => openReview(r)}>{next ? actionName(r.state) : 'Lihat detail'}</button>;
    })(),
  ])} />;
  if (!selected) return table;
  const next = nextFor(selected);
  const reviewCheckpoint = selected.state === 'STANDARDIZED' && next === 'CONTROLLER_REVIEW'
    || selected.state === 'CONTROLLER_REVIEW' && next === 'DATA_APPROVED';
  const arrears = [...new Set(arrearsText.split(/[,;\s]+/).map((item) => item.trim()).filter(Boolean))];
  return <>{table}{createPortal(<div className="directory-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelected(null); }}>
    <div className="directory-modal payroll-review-modal" role="dialog" aria-modal="true" aria-label="Review payroll submission">
      <div className="directory-modal-title"><div><span>PAYROLL REVIEW</span><h3>{selected.client_name || selected.client_id}</h3></div><button type="button" onClick={() => setSelected(null)}>✕</button></div>
      <div className="payroll-review-meta"><div><span>Payroll</span><strong>{selected.period}</strong></div><div><span>Project</span><strong>{selected.project_name || '-'}</strong></div><div><span>Tier</span><strong>{String(selected.service_tier || '-').replace('TIER_','Tier ').replaceAll('_',' ')}</strong></div><div><span>Status</span><strong>{selected.state}</strong></div></div>
      <div className="payroll-review-totals"><div><span>Karyawan</span><strong>{Number(selected.employee_count || 0)}</strong></div><div><span>Gross</span><strong>{formatIDR(Number(selected.total_gross || 0))}</strong></div><div><span>Potongan</span><strong>{formatIDR(Number(selected.total_deduction || 0))}</strong></div><div><span>Net/THP</span><strong>{formatIDR(Number(selected.total_net || 0))}</strong></div></div>
      <div className="payroll-review-alert"><strong>{Number(selected.blocking_count || 0)} blocker · {Number(selected.exception_count || 0)} total temuan</strong><span>{Number(selected.blocking_count || 0) ? 'Temuan kritis harus diselesaikan sebelum approval.' : 'Tidak ada temuan kritis yang memblokir tahap berikutnya.'}</span></div>
      <div className="directory-form-grid"><label>Periode payroll<input type="month" value={selected.period} readOnly /></label><label>Periode pembayaran<input type="month" value={paymentPeriod} onChange={(event) => setPaymentPeriod(event.target.value)} /></label></div>
      <label>Periode rapel (opsional)<input value={arrearsText} placeholder="Contoh: 2026-05, 2026-06" onChange={(event) => setArrearsText(event.target.value)} /></label>
      <p className="directory-hint">Periode payroll mengikuti sumber data. Periode pembayaran menentukan bulan pencairan; rapel mencatat periode tambahan yang dibayarkan bersamaan.</p>
      <button type="button" className="btn" onClick={() => void act({ action:'UPDATE_SUBMISSION_PERIODS', submissionId:selected.id, paymentPeriod, arrearsPeriods:arrears }, 'Periode pembayaran dan rapel diperbarui')}>Simpan periode</button>
      {reviewCheckpoint ? <><label>Catatan review<textarea rows={3} maxLength={1000} value={reviewNote} placeholder="Catatan akhir sebelum diserahkan ke tahap berikutnya" onChange={(event) => setReviewNote(event.target.value)} /></label><label className="payroll-review-confirm"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />Saya sudah memeriksa periode, jumlah karyawan, nilai payroll, dan exception.</label></> : null}
      <div className="directory-modal-actions"><button type="button" className="btn" onClick={() => setSelected(null)}>Tutup</button>{next ? <button type="button" className="btn btn-primary" disabled={reviewCheckpoint && !confirmed} onClick={() => void act(next === 'GENERATE_PAYMENT_INSTRUCTION' ? { action:next, submissionId:selected.id } : { action:'TRANSITION_SUBMISSION', submissionId:selected.id, toState:next, reviewConfirmed:reviewCheckpoint || undefined, reviewNote:reviewNote || undefined }, next === 'GENERATE_PAYMENT_INSTRUCTION' ? 'Payment instruction berhasil dibuat dan menunggu approval' : `Status diperbarui ke ${next}`).then(() => setSelected(null))}>{actionName(selected.state)}</button> : null}</div>
    </div>
  </div>, document.body)}</>;
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
  const [detail, setDetail] = useState<any | null>(null);
  const [detailError, setDetailError] = useState('');
  const [detailLoading, setDetailLoading] = useState(false);
  const [approvalConfirmed, setApprovalConfirmed] = useState(false);
  async function openDetail(id:string) {
    setDetailLoading(true); setDetailError(''); setApprovalConfirmed(false);
    try { setDetail(await getPaymentInstructionDetail(id)); }
    catch (error) { setDetailError(error instanceof Error ? error.message : 'Detail PI gagal dimuat'); }
    finally { setDetailLoading(false); }
  }
  if (!instructions.length) return <Empty title="Belum ada payment instruction" detail="Payment instruction akan tersedia setelah payroll selesai divalidasi dan disetujui." />;
  return <div style={{ display:'grid', gap:16 }}>
    <CardTable headers={['Instruction / Periode','Nilai','Status','Dibuat','Aksi']} rows={instructions.map((r) => {
      let action: React.ReactNode = <span style={small}>Menunggu tahap berikutnya</span>;
      if (r.status === 'PAYMENT_APPROVAL_PENDING') action = canApprove
        ? <button style={actionButton} onClick={() => void openDetail(r.id)}>Preview & Approve</button>
        : <button style={actionButton} onClick={() => void openDetail(r.id)}>Preview PI</button>;
      if (canReview && ['APPROVED_FOR_PAYMENT','DISBURSEMENT_PROCESSING'].includes(r.status)) action = <button style={actionButton} onClick={() => { setProofFor(r.id); setProof((p) => ({ ...p, amount:String(r.expected_total || '') })); }}>Catat Bukti</button>;
      if (canReview && r.status === 'PROOF_UPLOADED') action = <button style={actionButton} onClick={() => void act({ action:'RECONCILE_PAYMENT', paymentInstructionId:r.id }, 'Rekonsiliasi selesai')}>Rekonsiliasi</button>;
      if (!['PAYMENT_APPROVAL_PENDING','APPROVED_FOR_PAYMENT','DISBURSEMENT_PROCESSING','PROOF_UPLOADED'].includes(r.status)) action = <button style={actionButton} onClick={() => void openDetail(r.id)}>Detail PI</button>;
      return [<div key="id"><strong>{r.document_no || r.client_name || r.id}</strong><small style={small}>{r.client_name || '-'} · Payroll {r.payroll_period || '-'} · Bayar {r.payment_period || r.payroll_period || '-'}</small></div>, formatIDR(Number(r.expected_total || 0)), <Badge key="status" text={r.status} />, date(r.created_at), <span key="action">{action}</span>];
    })} />
    {detailLoading ? <div className="card" style={{padding:18}}>Memuat snapshot Payment Instruction…</div> : null}
    {detailError ? <div className="app-notice-bubble app-notice-error" role="alert"><strong>Detail PI gagal</strong><span>{detailError}</span></div> : null}
    {detail ? <div className="directory-modal-backdrop" onMouseDown={(event)=>{if(event.target===event.currentTarget)setDetail(null);}}><div className="directory-modal payroll-review-modal" role="dialog" aria-modal="true" aria-label="Preview Payment Instruction">
      <div className="directory-modal-title"><div><span>IMMUTABLE PAYMENT SNAPSHOT</span><h3>{detail.paymentInstruction.document_no || detail.paymentInstruction.id}</h3></div><button type="button" onClick={()=>setDetail(null)}>✕</button></div>
      <div className="payroll-review-meta"><div><span>Klien</span><strong>{detail.paymentInstruction.client_name}</strong></div><div><span>Payroll / Bayar</span><strong>{detail.paymentInstruction.payroll_period} / {detail.paymentInstruction.payment_period}</strong></div><div><span>Status</span><strong>{detail.paymentInstruction.status}</strong></div><div><span>Penerima</span><strong>{detail.control.recipientCount}</strong></div></div>
      <div className="payroll-review-alert"><strong>Control total: {formatIDR(detail.control.totalAmount)}</strong><span>{detail.control.balanced ? '✓ Total snapshot sama dengan expected total.' : '⛔ Total tidak seimbang—approval diblokir.'}</span></div>
      <p style={{...small,wordBreak:'break-all'}}>SHA-256: {detail.paymentInstruction.content_hash || 'Snapshot lama—hash tidak tersedia'}</p>
      <div style={{maxHeight:320,overflow:'auto'}}><CardTable headers={['Penerima','Bank','Rekening','Nominal']} rows={(detail.lines || []).map((line:any)=>[
        <div key="name"><strong>{line.beneficiary_name}</strong><small style={small}>{line.employee_id}</small></div>, line.bank_code || line.bank_name, `****${line.account_last4}`, formatIDR(Number(line.amount)),
      ])} /></div>
      <div style={{display:'flex',gap:8,flexWrap:'wrap',marginTop:12}}>
        <a className="btn" href={`/api/payment-instruction-export?id=${encodeURIComponent(detail.paymentInstruction.id)}&format=PDF`} target="_blank" rel="noreferrer">Unduh PDF PI</a>
        {['APPROVED_FOR_PAYMENT','DISBURSEMENT_PROCESSING','PROOF_UPLOADED','COMPLETED'].includes(detail.paymentInstruction.status) ? ['BCA','MANDIRI','BRI','BNI','CUSTOM'].map((format)=><a key={format} className="btn" href={`/api/payment-instruction-export?id=${encodeURIComponent(detail.paymentInstruction.id)}&format=${format}`}>{format}</a>) : null}
      </div>
      {detail.paymentInstruction.status === 'PAYMENT_APPROVAL_PENDING' && canApprove ? <><label className="payroll-review-confirm"><input type="checkbox" checked={approvalConfirmed} onChange={(event)=>setApprovalConfirmed(event.target.checked)} />Saya sudah memeriksa seluruh penerima, rekening tersamarkan, nominal, control total, dan content hash.</label><button className="btn btn-primary" disabled={!approvalConfirmed || !detail.control.balanced || !detail.paymentInstruction.content_hash} onClick={()=>void act({action:'APPROVE_PAYMENT',paymentInstructionId:detail.paymentInstruction.id,actionHash:detail.paymentInstruction.content_hash,confirmation:'KONFIRMASI PAYMENT'},'Payment Instruction disetujui berdasarkan content hash').then(()=>setDetail(null))}>Approve Payment Instruction</button></> : null}
      {detail.approvals?.length ? <div style={{marginTop:12}}><strong>Approval Trail</strong>{detail.approvals.map((approval:any)=><p key={approval.id} style={small}>{approval.status} · {approval.approver_email || approval.approver_user_id} · {date(approval.created_at)}</p>)}</div> : null}
    </div></div> : null}
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
      {uploadError && <div className="app-notice-bubble app-notice-error" role="alert"><strong>Upload bukti gagal</strong><span>{uploadError}</span><button type="button" aria-label="Tutup pesan" onClick={() => setUploadError('')}>✕</button></div>}
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

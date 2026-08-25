'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { executeOperatingAction, getPayRunDetail, getPaymentInstructionDetail, listOperatingResource, type OperatingResource } from '@/lib/operating-model-api';
import { formatIDR } from '@/lib/format';
import BillingWorkspace from '@/components/BillingWorkspace';

type WorkspaceMode = 'payruns' | 'actions' | 'payments' | 'billing' | 'integrations';
type Actor = { email: string; role: string; permissions?: string[]; clientIds?: string[]; projectIds?: string[] };

const profiles: Record<WorkspaceMode, { title:string; eyebrow:string; description:string; search:string }> = {
  payruns: { title:'Pay Runs', eyebrow:'PAYROLL EXECUTION', description:'Kelola setiap periode payroll dari intake sampai siap dibayarkan.', search:'Klien, project, pay run…' },
  actions: { title:'Action Center', eyebrow:'EXCEPTION WORK QUEUE', description:'Selesaikan blocker dan temuan payroll berdasarkan prioritas dan status.', search:'Karyawan, temuan, klien…' },
  payments: { title:'Payment Control', eyebrow:'PAYMENT INTEGRITY', description:'Kontrol Payment Instruction, approval, proof, dan rekonsiliasi.', search:'Dokumen PI, klien, project…' },
  billing: { title:'Billing & AR', eyebrow:'FINANCE OPERATIONS', description:'Kelola invoice layanan, jatuh tempo, dan pelunasan piutang.', search:'Invoice, klien, periode…' },
  integrations: { title:'Integrations', eyebrow:'CONNECTED SYSTEMS', description:'Pantau koneksi HRIS, attendance, accounting, dan bank.', search:'Koneksi, tipe, status…' },
};

const stateTone = (state: string) => state.includes('EXCEPTION') || state.includes('REJECT') ? '#dc2626'
  : state.includes('APPROVED') || state === 'COMPLETED' || state === 'MATCHED' ? '#059669' : 'var(--accent)';

export default function OperatingWorkspace({ mode = 'payruns' }: { mode?: WorkspaceMode }) {
  const [actor, setActor] = useState<Actor | null>(null);
  const [data, setData] = useState<Record<string, any[]>>({});
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [periodFilter, setPeriodFilter] = useState('ALL');
  const [clientFilter, setClientFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [query, setQuery] = useState('');
  const [createOpen, setCreateOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setMessage('');
    try {
      const resources: OperatingResource[] = mode === 'payruns' ? ['submissions','pay-run-setup']
        : mode === 'actions' ? ['submissions','exceptions']
        : mode === 'payments' ? ['submissions','payment-instructions','payment-proofs','reconciliations']
        : mode === 'integrations' ? ['integrations'] : [];
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
  }, [mode]);

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
  // The backend remains authoritative; role fallback prevents a stale /api/me
  // permission payload from hiding the Controller approval workflow.
  const canApprovePayment = isController || actor?.permissions?.includes('payment:approve') || false;
  const submissions = useMemo(() => data.submissions || [], [data.submissions]);
  const periods = useMemo(() => [...new Set(submissions.map((row) => String(row.period || '')).filter(Boolean))].sort((a, b) => b.localeCompare(a)), [submissions]);
  const clients = useMemo(() => {
    const map = new Map<string, string>();
    submissions.forEach((row) => map.set(String(row.client_id), String(row.client_name || row.client_id)));
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [submissions]);
  const visibleSubmissions = useMemo(() => submissions.filter((row) => {
    const haystack = [row.client_name,row.project_name,row.id,row.period,row.payment_period,row.state].join(' ').toLowerCase();
    return (periodFilter === 'ALL' || row.period === periodFilter || row.payment_period === periodFilter)
      && (clientFilter === 'ALL' || row.client_id === clientFilter)
      && (statusFilter === 'ALL' || row.state === statusFilter)
      && (!query.trim() || haystack.includes(query.trim().toLowerCase()));
  }), [submissions, periodFilter, clientFilter, statusFilter, query]);
  const visibleSubmissionIds = useMemo(() => new Set(visibleSubmissions.map((row) => row.id)), [visibleSubmissions]);
  const visibleInstructions = useMemo(() => (data.paymentInstructions || []).filter((row) => {
    const periodMatches = periodFilter === 'ALL' || row.payroll_period === periodFilter || row.payment_period === periodFilter;
    const clientMatches = clientFilter === 'ALL' || row.client_id === clientFilter;
    const statusMatches = statusFilter === 'ALL' || row.status === statusFilter;
    const queryMatches = !query.trim() || [row.document_no,row.client_name,row.project_name,row.status].join(' ').toLowerCase().includes(query.trim().toLowerCase());
    return periodMatches && clientMatches && statusMatches && queryMatches;
  }), [data.paymentInstructions, periodFilter, clientFilter, statusFilter, query]);
  const visibleInstructionIds = useMemo(() => new Set(visibleInstructions.map((row) => row.id)), [visibleInstructions]);
  const visibleExceptions = useMemo(() => (data.exceptions || []).filter((row) => visibleSubmissionIds.has(row.submission_id)), [data.exceptions, visibleSubmissionIds]);
  const visibleProofs = useMemo(() => (data.paymentProofs || []).filter((row) => visibleInstructionIds.has(row.payment_instruction_id)), [data.paymentProofs, visibleInstructionIds]);
  const visibleReconciliations = useMemo(() => (data.reconciliations || []).filter((row) => visibleInstructionIds.has(row.payment_instruction_id)), [data.reconciliations, visibleInstructionIds]);
  const totalNet = visibleSubmissions.reduce((sum, row) => sum + Number(row.total_net || 0), 0);
  const blockers = visibleSubmissions.reduce((sum, row) => sum + Number(row.blocking_count || 0), 0);
  const pendingActions = visibleSubmissions.filter((row) => !['COMPLETED','RECONCILIATION'].includes(row.state)).length;
  const openExceptions = visibleExceptions.filter((row) => !['RESOLVED','ACCEPTED','AUTO_NORMALIZED'].includes(row.status));
  const criticalExceptions = openExceptions.filter((row) => row.severity === 'CRITICAL');
  const affectedRuns = new Set(openExceptions.map((row) => row.submission_id)).size;
  const awaitingApproval = visibleInstructions.filter((row) => ['PAYMENT_INSTRUCTION_READY','PAYMENT_APPROVAL_PENDING'].includes(row.status)).length;
  const approvedPayments = visibleInstructions.filter((row) => ['APPROVED_FOR_PAYMENT','DISBURSEMENT_PROCESSING','PROOF_UPLOADED','COMPLETED'].includes(row.status)).length;
  const matchedPayments = visibleReconciliations.filter((row) => row.status === 'MATCHED').length;
  const profile = profiles[mode];
  const statusOptions = mode === 'payments'
    ? [...new Set((data.paymentInstructions || []).map((row) => row.status))].sort()
    : [...new Set(submissions.map((row) => row.state))].sort();

  return (
    <section>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div>
          <span className="workspace-eyebrow">{profile.eyebrow}</span>
          <h2 style={{ fontSize: 22, fontWeight: 720, margin: '4px 0 0' }}>{profile.title}</h2>
          <p style={{ color: 'var(--text3)', fontSize: 13, marginTop: 5 }}>{profile.description}</p>
        </div>
        <div style={{display:'flex',gap:8,alignItems:'center'}}>{mode==='payruns'&&['SUPER_ADMIN','PAYROLL_PROCESSOR'].includes(role)?<button type="button" className="btn btn-primary" onClick={()=>setCreateOpen(true)}>+ Buat Pay Run</button>:null}<div className="card" style={{ padding: '8px 12px', fontSize: 12 }}><strong>{actor?.email || 'Memuat pengguna…'}</strong><span style={{ color: 'var(--text3)', marginLeft: 8 }}>{role.replaceAll('_', ' ')}</span></div></div>
      </div>

      {!['billing','integrations'].includes(mode) ? <div className="operations-control-bar">
        <label><span>Periode</span><select value={periodFilter} onChange={(event) => setPeriodFilter(event.target.value)}><option value="ALL">Semua periode</option>{periods.map((period) => <option key={period} value={period}>{period}</option>)}</select></label>
        <label><span>Klien</span><select value={clientFilter} onChange={(event) => setClientFilter(event.target.value)}><option value="ALL">Semua klien</option>{clients.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
        <label><span>{mode === 'payments' ? 'Status PI' : 'Status pay run'}</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="ALL">Semua status</option>{statusOptions.map((state) => <option key={state} value={state}>{String(state).replaceAll('_', ' ')}</option>)}</select></label>
        <label className="operations-search"><span>Pencarian</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={profile.search} /></label>
      </div> : null}

      {!['billing','integrations'].includes(mode) ? <div className="operations-summary-grid">
        {mode === 'payruns' ? <>
          <div><span>Pay runs</span><strong>{visibleSubmissions.length}</strong><small>{periodFilter === 'ALL' ? `${periods.length} periode` : periodFilter}</small></div>
          <div><span>Control total</span><strong>{formatIDR(totalNet)}</strong><small>Net/THP submission</small></div>
          <div><span>Active workflow</span><strong>{pendingActions}</strong><small>{visibleSubmissions.reduce((sum,row)=>sum+Number(row.employee_count||0),0).toLocaleString('id-ID')} penerima</small></div>
          <div><span>Blocked</span><strong>{blockers}</strong><small>Temuan kritis aktif</small></div>
        </> : mode === 'actions' ? <>
          <div><span>Open exceptions</span><strong>{openExceptions.length}</strong><small>Antrean aktif</small></div>
          <div><span>Critical blockers</span><strong>{criticalExceptions.length}</strong><small>Harus diselesaikan</small></div>
          <div><span>Affected pay runs</span><strong>{affectedRuns}</strong><small>Dari {visibleSubmissions.length} pay run</small></div>
          <div><span>Client action</span><strong>{openExceptions.filter((row)=>row.status==='CLIENT_ACTION_REQUIRED').length}</strong><small>Menunggu perbaikan</small></div>
        </> : <>
          <div><span>Payment Instructions</span><strong>{visibleInstructions.length}</strong><small>{visibleInstructions.reduce((sum,row)=>sum+Number(row.recipient_count||0),0).toLocaleString('id-ID')} penerima</small></div>
          <div><span>PI value</span><strong>{formatIDR(visibleInstructions.reduce((sum,row)=>sum+Number(row.expected_total||0),0))}</strong><small>Control total</small></div>
          <div><span>Awaiting approval</span><strong>{awaitingApproval}</strong><small>{approvedPayments} approved / processing</small></div>
          <div><span>Reconciliation</span><strong>{matchedPayments}</strong><small>{visibleReconciliations.length-matchedPayments} belum match</small></div>
        </>}
      </div> : null}

      {message && <div className={`app-notice-bubble ${/gagal|error|tidak|unavailable|belum siap|invalid/i.test(message) ? 'app-notice-error' : 'app-notice-info'}`} role="status"><strong>{/gagal|error|tidak|unavailable|belum siap|invalid/i.test(message) ? 'Perlu perhatian' : 'Informasi'}</strong><span>{message}</span><button type="button" aria-label="Tutup pesan" onClick={() => setMessage('')}>✕</button></div>}
      {loading ? <Empty title="Memuat data operasional…" /> : (
        <>
          {mode === 'payruns' && <Submissions rows={visibleSubmissions} role={role} act={act} />}
          {mode === 'actions' && <Exceptions rows={visibleExceptions} role={role} canResolve={isProcessor || isController || isClient} act={act} />}
          {mode === 'payments' && <Payments instructions={visibleInstructions} proofs={visibleProofs} reconciliations={visibleReconciliations} role={role} canReview={isProcessor || isController} canApprove={canApprovePayment && isController} act={act} />}
          {mode === 'billing' && actor && <BillingWorkspace actor={actor} />}
          {mode === 'integrations' && <Integrations rows={data.integrations || []} canCreate={isProcessor} />}
        </>
      )}
      {createOpen ? <CreatePayRunWizard clients={data.clients||[]} projects={data.projects||[]} servicePlans={data.servicePlans||[]} submissions={submissions} onClose={()=>setCreateOpen(false)} onCreated={async()=>{setCreateOpen(false);await load();}} /> : null}
    </section>
  );
}

function CreatePayRunWizard({clients,projects,servicePlans,submissions,onClose,onCreated}:{clients:any[];projects:any[];servicePlans:any[];submissions:any[];onClose:()=>void;onCreated:()=>Promise<void>}) {
  const planCoversPeriod=(row:any,period:string)=>{
    const start=`${period}-01`; const [year,month]=period.split('-').map(Number);
    const end=new Date(Date.UTC(year,month,0)).toISOString().slice(0,10);
    return row.effective_from<=end&&(!row.effective_until||row.effective_until>=start);
  };
  const plansForScope=(clientId:string,projectId:string,period:string)=>{
    const candidates=servicePlans.filter((row)=>row.client_id===clientId&&(!row.project_id||row.project_id===projectId)&&planCoversPeriod(row,period));
    const exact=candidates.filter((row)=>row.project_id===projectId);
    return exact.length?exact:candidates.filter((row)=>!row.project_id);
  };
  const currentPeriod=new Date().toISOString().slice(0,7);
  const [step,setStep]=useState(1); const [busy,setBusy]=useState(false); const [error,setError]=useState('');
  const [form,setForm]=useState({clientId:'',projectId:'',servicePlanId:'',period:currentPeriod,paymentPeriod:currentPeriod,paymentDate:`${currentPeriod}-25`,runType:'REGULAR',sourceMode:'MASTER_CURRENT',parentSubmissionId:''});
  const scopedProjects=projects.filter((row)=>row.client_id===form.clientId);
  const client=clients.find((row)=>row.id===form.clientId);
  const clientPlans=servicePlans.filter((row)=>row.client_id===form.clientId);
  const scopedPlans=plansForScope(form.clientId,form.projectId,form.period);
  const parentRuns=submissions.filter((row)=>row.client_id===form.clientId&&row.project_id===form.projectId);
  const project=scopedProjects.find((row)=>row.id===form.projectId); const plan=scopedPlans.find((row)=>row.id===form.servicePlanId);
  const patch=(value:Record<string,string>)=>setForm((current)=>({...current,...value}));
  const canNext=step===1?Boolean(form.clientId&&form.projectId&&Number(project?.employee_count||0)>0&&form.servicePlanId&&plan):step===2?Boolean(form.paymentPeriod&&form.paymentDate&&form.runType&&form.sourceMode&&(form.runType!=='ADJUSTMENT'||form.parentSubmissionId)):true;
  function selectClient(clientId:string){
    const availableProjects=projects.filter((row)=>row.client_id===clientId&&Number(row.employee_count||0)>0);
    const projectId=availableProjects.length===1?availableProjects[0].id:'';
    const availablePlans=plansForScope(clientId,projectId,form.period);
    patch({clientId,projectId,servicePlanId:availablePlans.length===1?availablePlans[0].id:''});
  }
  function selectPeriod(period:string){
    const availablePlans=plansForScope(form.clientId,form.projectId,period);
    patch({period,paymentPeriod:period,paymentDate:`${period}-25`,servicePlanId:availablePlans.length===1?availablePlans[0].id:''});
  }
  function selectProject(projectId:string){
    const hasPrevious=submissions.some((row)=>row.client_id===form.clientId&&row.project_id===projectId&&row.run_type==='REGULAR'&&row.period<form.period&&row.state!=='CANCELLED');
    const availablePlans=plansForScope(form.clientId,projectId,form.period);
    patch({projectId,servicePlanId:availablePlans.length===1?availablePlans[0].id:'',sourceMode:hasPrevious?'COPY_PREVIOUS':'MASTER_CURRENT'});
  }
  async function create(){setBusy(true);setError('');try{await executeOperatingAction({action:'CREATE_PAY_RUN',...form});await onCreated();}catch(cause){setError(cause instanceof Error?cause.message:'Pay Run gagal dibuat');setBusy(false);}}
  return createPortal(<div className="directory-modal-backdrop" onMouseDown={(event)=>{if(event.target===event.currentTarget&&!busy)onClose();}}><div className="directory-modal pay-run-wizard" role="dialog" aria-modal="true" aria-label="Buat Pay Run">
    <div className="directory-modal-title"><div><span>CREATE PAY RUN · STEP {step}/3</span><h3>{step===1?'Pilih scope payroll':step===2?'Atur periode dan sumber':'Review & buat snapshot'}</h3></div><button type="button" disabled={busy} onClick={onClose}>✕</button></div>
    <div className="pay-run-stepper"><i className={step>=1?'active':''}/><i className={step>=2?'active':''}/><i className={step>=3?'active':''}/></div>
    {step===1?<><div className="directory-form-grid"><label>Klien<select value={form.clientId} onChange={(event)=>selectClient(event.target.value)}><option value="">Pilih klien</option>{clients.map((row)=><option key={row.id} value={row.id}>{row.name} · {Number(row.employee_count||0)} karyawan</option>)}</select></label><label>Periode payroll<input type="month" value={form.period} onChange={(event)=>selectPeriod(event.target.value)}/></label><label>Project<select value={form.projectId} disabled={!form.clientId} onChange={(event)=>selectProject(event.target.value)}><option value="">Pilih project</option>{scopedProjects.map((row)=><option key={row.id} value={row.id} disabled={!Number(row.employee_count||0)}>{row.name} · {Number(row.employee_count||0)} karyawan{!Number(row.employee_count||0)?' · belum terhubung':''}</option>)}</select></label><label>Service tier<select value={form.servicePlanId} disabled={!form.clientId} onChange={(event)=>patch({servicePlanId:event.target.value})}><option value="">Pilih tier untuk periode ini</option>{scopedPlans.map((row)=><option key={row.id} value={row.id}>{String(row.tier).replaceAll('_',' ')}</option>)}</select></label></div>{client&&Number(client.employee_count||0)>0&&!scopedProjects.some((row)=>Number(row.employee_count||0)>0)?<div className="app-notice-bubble app-notice-error"><strong>Assignment project belum lengkap</strong><span>{Number(client.employee_count||0)} karyawan klien terdeteksi, tetapi belum terhubung ke project aktif. Perbarui Project pada master Employees sebelum membuat Pay Run.</span></div>:null}{client&&Number(client.unassigned_employee_count||0)>0?<div className="app-notice-bubble app-notice-info"><strong>Perlu melengkapi assignment</strong><span>{Number(client.unassigned_employee_count)} karyawan belum memiliki project dan tidak akan masuk snapshot payroll.</span></div>:null}{form.clientId&&!scopedPlans.length?<div className="app-notice-bubble app-notice-error"><strong>Tier tidak aktif pada periode {form.period}</strong><span>{clientPlans.length?'Ubah periode atau perbarui effective date service plan klien.':'Buat service plan Tier 1, Tier 2, atau Tier 3 terlebih dahulu.'}</span></div>:null}</>:null}
    {step===2?<div className="directory-form-grid"><label>Periode pembayaran<input type="month" value={form.paymentPeriod} onChange={(event)=>patch({paymentPeriod:event.target.value})}/></label><label>Tanggal pembayaran<input type="date" value={form.paymentDate} onChange={(event)=>patch({paymentDate:event.target.value})}/></label><label>Jenis Pay Run<select value={form.runType} onChange={(event)=>patch({runType:event.target.value,parentSubmissionId:''})}><option value="REGULAR">Regular payroll</option><option value="OFF_CYCLE">Off-cycle payroll</option><option value="ADJUSTMENT">Adjustment</option></select></label><label className="directory-form-wide">Sumber data<select value={form.sourceMode} onChange={(event)=>patch({sourceMode:event.target.value})}><option value="COPY_PREVIOUS">Salin periode sebelumnya</option><option value="UPLOAD_FINAL">Upload data final klien</option><option value="MASTER_CURRENT">Master data terbaru</option><option value="HRIS">Integrasi HRIS</option></select><small>{form.sourceMode==='COPY_PREVIOUS'?'Saat Pay Run dibuat, seluruh nominal periode terbaru sebelumnya otomatis disalin. Buka Pay Run untuk review variance bulan ini.':form.sourceMode==='UPLOAD_FINAL'?'Setelah Pay Run dibuat, klik Buka Pay Run lalu pilih file Excel pada bagian Upload payroll final klien.':form.sourceMode==='MASTER_CURRENT'?'Payroll periode yang sama dipakai bila tersedia; jika tidak, gaji pokok master menjadi gross/THP awal.':'Snapshot menunggu data dari konektor HRIS; status tetap pending sampai sinkronisasi berhasil.'}</small></label>{form.runType==='ADJUSTMENT'?<label className="directory-form-wide">Pay Run induk<select value={form.parentSubmissionId} onChange={(event)=>patch({parentSubmissionId:event.target.value})}><option value="">Pilih Pay Run yang dikoreksi</option>{parentRuns.map((row)=><option key={row.id} value={row.id}>{row.period} · {row.id}</option>)}</select></label>:null}</div>:null}
    {step===3?<div className="pay-run-review"><div><span>Scope</span><strong>{clients.find((row)=>row.id===form.clientId)?.name||'-'}</strong><small>{project?.name||'-'} · {Number(project?.employee_count||0)} karyawan aktif</small></div><div><span>Periode</span><strong>{form.period}</strong><small>Bayar {form.paymentDate}</small></div><div><span>Service</span><strong>{String(plan?.tier||'-').replaceAll('_',' ')}</strong><small>{form.runType.replaceAll('_',' ')}</small></div><div><span>Sumber</span><strong>{form.sourceMode.replaceAll('_',' ')}</strong><small>Snapshot terpisah dari master data</small></div><p>Pay Run dibuat per project dan periode. Perubahan master berikutnya tidak akan mengubah snapshot periode ini.</p></div>:null}
    {error?<div className="app-notice-bubble app-notice-error"><strong>Pay Run belum dibuat</strong><span>{error}</span></div>:null}
    <div className="directory-modal-actions"><button type="button" className="btn" disabled={busy} onClick={()=>step===1?onClose():setStep((value)=>value-1)}>{step===1?'Batal':'Kembali'}</button>{step<3?<button type="button" className="btn btn-primary" disabled={!canNext} onClick={()=>setStep((value)=>value+1)}>Lanjut</button>:<button type="button" className="btn btn-primary" disabled={busy} onClick={()=>void create()}>{busy?'Membuat snapshot…':'Buat Pay Run'}</button>}</div>
  </div></div>,document.body);
}

function Submissions({ rows, role, act }: { rows: any[]; role: string; act: (p: Record<string, unknown>, s: string) => Promise<void> }) {
  const [selected, setSelected] = useState<any | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [reviewNote, setReviewNote] = useState('');
  const [paymentPeriod, setPaymentPeriod] = useState('');
  const [arrearsText, setArrearsText] = useState('');
  const [runDetail,setRunDetail]=useState<any|null>(null);
  const [runDetailLoading,setRunDetailLoading]=useState(false);
  if (!rows.length) return <Empty title="Belum ada payroll submission" detail="Submission baru akan tampil setelah service plan klien aktif dan data periode dikirim." />;
  const validationStates = new Set(['DRAFT','SUBMITTED','INGESTING','AI_VALIDATING','CLIENT_RESUBMITTED','REVISION_REQUIRED']);
  function nextFor(row:any) {
    if (role === 'CLIENT_USER') return undefined;
    if (['SUPER_ADMIN','PAYROLL_CONTROLLER'].includes(role) && row.state === 'CONTROLLER_REVIEW') return 'DATA_APPROVED';
    if (['SUPER_ADMIN','PAYROLL_CONTROLLER'].includes(role) && row.state === 'DATA_APPROVED') return 'PAYMENT_INSTRUCTION_READY';
    if (['SUPER_ADMIN','PAYROLL_CONTROLLER'].includes(role) && row.state === 'PAYROLL_FINALIZED') return 'PAYMENT_INSTRUCTION_READY';
    if (['SUPER_ADMIN','PAYROLL_PROCESSOR'].includes(role) && row.state === 'PAYMENT_INSTRUCTION_READY') return 'GENERATE_PAYMENT_INSTRUCTION';
    if (['SUPER_ADMIN','PAYROLL_PROCESSOR'].includes(role) && validationStates.has(row.state)) return 'ADVANCE_VALIDATE';
    if (['SUPER_ADMIN','PAYROLL_PROCESSOR'].includes(role) && ['VALIDATED','STANDARDIZED'].includes(row.state)) return 'ADVANCE_FINALIZE';
    if (['SUPER_ADMIN','PAYROLL_PROCESSOR'].includes(role) && row.state === 'EXCEPTION_FOUND') return 'CLIENT_ACTION_REQUIRED';
    return undefined;
  }
  function openReview(row:any) {
    setSelected(row); setConfirmed(false); setReviewNote('');
    setPaymentPeriod(row.payment_period || row.period || '');
    setArrearsText(Array.isArray(row.arrears_periods) ? row.arrears_periods.join(', ') : '');
    setRunDetail(null);setRunDetailLoading(true);
    void getPayRunDetail(row.id).then(setRunDetail).finally(()=>setRunDetailLoading(false));
  }
  const actionName = (state:string) => ({ DRAFT:'Validasi Pay Run', SUBMITTED:'Validasi Pay Run', INGESTING:'Selesaikan validasi', AI_VALIDATING:'Selesaikan validasi', EXCEPTION_FOUND:'Minta perbaikan klien', CLIENT_RESUBMITTED:'Validasi ulang', REVISION_REQUIRED:'Validasi ulang', VALIDATED:'Finalisasi Payroll', STANDARDIZED:'Finalisasi Payroll', CONTROLLER_REVIEW:'Setujui Data Payroll', DATA_APPROVED:'Siapkan Payment Instruction', PAYROLL_FINALIZED:'Siapkan Payment Instruction', PAYMENT_INSTRUCTION_READY:'Buat Payment Instruction' }[state] || 'Lihat detail');
  const table = <CardTable headers={['Klien / Periode','Tier','Status','Ringkasan','Aksi']} rows={rows.map((r) => [
    <div key="id"><strong>{r.client_name || r.client_id}</strong><small style={small}>Payroll {r.period} · Bayar {r.payment_period || r.period}</small><small style={small}>{r.project_name || r.id} · {String(r.run_type||'REGULAR').replaceAll('_',' ')}</small></div>,
    String(r.service_tier || '-').replace('TIER_','Tier ').replaceAll('_',' '),
    <Badge key="state" text={r.state} />,
    <div key="summary"><strong>{Number(r.employee_count || 0)} karyawan</strong><small style={small}>{formatIDR(Number(r.total_net || 0))} · {Number(r.blocking_count || 0)} blocker</small></div>,
    (() => {
      return <button key="action" style={actionButton} onClick={() => openReview(r)}>Buka Pay Run</button>;
    })(),
  ])} />;
  if (!selected) return table;
  const next = nextFor(selected);
  const flowStates=['Data Readiness','Payroll Processing','PI Preparation','Approval & Payment','Reconciliation & Billing'];
  const currentFlowIndex=['DRAFT'].includes(selected.state)?0
      : ['SUBMITTED','INGESTING','AI_VALIDATING','EXCEPTION_FOUND','CLIENT_ACTION_REQUIRED','CLIENT_RESUBMITTED','REVISION_REQUIRED','VALIDATED','STANDARDIZED','CONTROLLER_REVIEW'].includes(selected.state)?1
      : ['DATA_APPROVED','PAYROLL_FINALIZED','PAYMENT_INSTRUCTION_READY'].includes(selected.state)?2:['PAYMENT_APPROVAL_PENDING','APPROVED_FOR_PAYMENT','DISBURSEMENT_PROCESSING','PROOF_UPLOADED'].includes(selected.state)?3:4;
  const reviewCheckpoint = next === 'ADVANCE_FINALIZE' || (['SUPER_ADMIN','PAYROLL_CONTROLLER'].includes(role) && selected.state === 'CONTROLLER_REVIEW');
  const arrears = [...new Set(arrearsText.split(/[,;\s]+/).map((item) => item.trim()).filter(Boolean))];
  return <>{table}{createPortal(<div className="directory-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelected(null); }}>
    <div className="directory-modal payroll-review-modal" role="dialog" aria-modal="true" aria-label="Review payroll submission">
      <div className="directory-modal-title"><div><span>PAYROLL REVIEW</span><h3>{selected.client_name || selected.client_id}</h3></div><button type="button" onClick={() => setSelected(null)}>✕</button></div>
      <div className="payroll-review-meta"><div><span>Payroll</span><strong>{selected.period}</strong></div><div><span>Project</span><strong>{selected.project_name || '-'}</strong></div><div><span>Tier</span><strong>{String(selected.service_tier || '-').replace('TIER_','Tier ').replaceAll('_',' ')}</strong></div><div><span>Status</span><strong>{selected.state}</strong></div></div>
      <div className="pay-run-lifecycle"><span className={selected.input_status==='READY'?'ready':''}>Input {selected.input_status||'LEGACY'}</span><span>{String(selected.run_type||'REGULAR').replaceAll('_',' ')}</span><span>{String(selected.source_mode||'UPLOAD_FINAL').replaceAll('_',' ')}</span><span className={selected.period_status==='CLOSED'?'closed':''}>Periode {selected.period_status||'OPEN'}</span></div>
      <div className="pay-run-flow-guide" aria-label="Tahapan Pay Run menuju Payment Instruction">{flowStates.map((state,index)=><div key={state} className={index<currentFlowIndex?'done':index===currentFlowIndex?'current':''}><i>{index<currentFlowIndex?'✓':index+1}</i><span>{state}</span></div>)}</div>
      <div className={`pay-run-next-action ${selected.input_status==='PENDING'?'pending':''}`}><strong>{selected.input_status==='PENDING'?'Input belum siap disubmit':next?`Aksi berikutnya: ${actionName(selected.state)}`:'Tidak ada aksi workflow untuk role ini'}</strong><span>{selected.input_status==='PENDING'?(selected.source_mode==='UPLOAD_FINAL'?'Upload file payroll final di bawah, periksa control total, lalu finalisasi input.':selected.source_mode==='MASTER_CURRENT'?'Hitung ulang dari master bila ada perubahan, periksa penerima, lalu finalisasi input.':'Lengkapi nominal dan rekening penerima sebelum finalisasi input.'):'Setelah aksi berhasil, status Pay Run berubah dan tetap dapat dipantau dari tabel Pay Runs.'}</span></div>
      <div className="payroll-review-totals"><div><span>Karyawan</span><strong>{Number(selected.employee_count || 0)}</strong></div><div><span>Gross</span><strong>{formatIDR(Number(selected.total_gross || 0))}</strong></div><div><span>Potongan</span><strong>{formatIDR(Number(selected.total_deduction || 0))}</strong></div><div><span>Net/THP</span><strong>{formatIDR(Number(selected.total_net || 0))}</strong></div></div>
      {runDetailLoading?<div className="directory-hint">Menghitung variance terhadap periode sebelumnya…</div>:runDetail?<div className="pay-run-variance"><div><span>Periode pembanding</span><strong>{runDetail.previousPeriod||'Periode pertama'}</strong></div><div><span>Variance THP</span><strong>{formatIDR(Number(runDetail.variance?.amount||0))}</strong><small>{runDetail.variance?.percent===null?'-':`${runDetail.variance.percent}%`}</small></div><div><span>Karyawan baru</span><strong>{runDetail.variance?.newEmployees||0}</strong></div><div><span>Berubah / keluar</span><strong>{runDetail.variance?.changedEmployees||0} / {runDetail.variance?.removedEmployees||0}</strong></div></div>:null}
      {runDetail?<PayRunLineTable detail={runDetail} editable={['SUPER_ADMIN','PAYROLL_PROCESSOR'].includes(role)&&selected.period_status!=='CLOSED'&&['DRAFT','SUBMITTED','INGESTING','AI_VALIDATING','REVISION_REQUIRED'].includes(selected.state)} onEdit={async(line,gross,deduction,included)=>{await act({action:'UPDATE_PAY_RUN_LINE',submissionId:selected.id,employeeId:line.employee_id,grossAmount:gross,deductionAmount:deduction,netAmount:gross-deduction,included},'Data bulanan karyawan diperbarui');setSelected(null);}}/>:null}
      {selected.source_mode==='UPLOAD_FINAL'&&selected.state==='DRAFT'&&selected.period_status!=='CLOSED'?<PayRunUpload submission={selected} onImported={async(total)=>{await act({},`File payroll final berhasil dimuat: ${total} penerima`);setSelected(null);}}/>:null}
      <div className="payroll-review-alert"><strong>{Number(selected.blocking_count || 0)} blocker · {Number(selected.exception_count || 0)} total temuan</strong><span>{Number(selected.blocking_count || 0) ? 'Temuan kritis harus diselesaikan sebelum approval.' : 'Tidak ada temuan kritis yang memblokir tahap berikutnya.'}</span></div>
      <div className="directory-form-grid"><label>Periode payroll<input type="month" value={selected.period} readOnly /></label><label>Periode pembayaran<input type="month" value={paymentPeriod} readOnly={role==='CLIENT_USER'} onChange={(event) => setPaymentPeriod(event.target.value)} /></label></div>
      <label>Periode rapel (opsional)<input value={arrearsText} placeholder="Contoh: 2026-05, 2026-06" onChange={(event) => setArrearsText(event.target.value)} /></label>
      <p className="directory-hint">Periode payroll mengikuti sumber data. Periode pembayaran menentukan bulan pencairan; rapel mencatat periode tambahan yang dibayarkan bersamaan.</p>
      {role!=='CLIENT_USER'?<button type="button" className="btn" onClick={() => void act({ action:'UPDATE_SUBMISSION_PERIODS', submissionId:selected.id, paymentPeriod, arrearsPeriods:arrears }, 'Periode pembayaran dan rapel diperbarui')}>Simpan periode</button>:null}
      {reviewCheckpoint ? <><label>Catatan review<textarea rows={3} maxLength={1000} value={reviewNote} placeholder="Catatan akhir sebelum diserahkan ke tahap berikutnya" onChange={(event) => setReviewNote(event.target.value)} /></label><label className="payroll-review-confirm"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />Saya sudah memeriksa periode, jumlah karyawan, nilai payroll, dan exception.</label></> : null}
      <div className="directory-modal-actions"><button type="button" className="btn" onClick={() => setSelected(null)}>Tutup</button>{['SUPER_ADMIN','PAYROLL_PROCESSOR'].includes(role)&&selected.state==='DRAFT'&&selected.period_status!=='CLOSED'?<button type="button" className="btn btn-danger" onClick={()=>{const confirmation=window.prompt(`Hapus Pay Run ${selected.client_name||selected.client_id} periode ${selected.period}?\nKetik HAPUS PAY RUN untuk melanjutkan.`);if(confirmation==='HAPUS PAY RUN')void act({action:'DELETE_PAY_RUN',submissionId:selected.id,confirmation},'Pay Run dan snapshot input berhasil dihapus').then(()=>setSelected(null));}}>Hapus Pay Run</button>:null}{['SUPER_ADMIN','PAYROLL_PROCESSOR'].includes(role)&&selected.source_mode==='MASTER_CURRENT'&&selected.period_status!=='CLOSED'&&['DRAFT','SUBMITTED','INGESTING','AI_VALIDATING','REVISION_REQUIRED'].includes(selected.state)?<button type="button" className="btn" onClick={()=>void act({action:'REFRESH_PAY_RUN_FROM_MASTER',submissionId:selected.id},'Nominal Pay Run dihitung ulang dari master kompensasi').then(()=>setSelected(null))}>Hitung ulang dari master</button>:null}{['SUPER_ADMIN','PAYROLL_PROCESSOR'].includes(role)&&selected.input_status==='PENDING'?<button type="button" className="btn" onClick={()=>void act({action:'FINALIZE_PAY_RUN_INPUT',submissionId:selected.id,confirmation:'DATA PAYROLL FINAL'},'Input Pay Run berhasil difinalisasi').then(()=>setSelected(null))}>Finalisasi input</button>:null}{['SUPER_ADMIN','PAYROLL_CONTROLLER'].includes(role)&&selected.period_status==='CLOSED'?<button type="button" className="btn" onClick={()=>{const reason=window.prompt('Alasan membuka kembali periode (minimal 10 karakter):');if(reason)void act({action:'REOPEN_PAY_RUN',submissionId:selected.id,reason,confirmation:'BUKA KEMBALI'},'Periode dibuka kembali untuk revisi').then(()=>setSelected(null));}}>Buka kembali</button>:null}{['SUPER_ADMIN','PAYROLL_CONTROLLER'].includes(role)&&selected.period_status!=='CLOSED'&&['PAYROLL_FINALIZED','COMPLETED'].includes(selected.state)?<button type="button" className="btn" onClick={()=>{if(window.confirm('Tutup periode payroll ini? Snapshot tidak dapat diubah.'))void act({action:'CLOSE_PAY_RUN',submissionId:selected.id,confirmation:'TUTUP PERIODE'},'Periode payroll ditutup').then(()=>setSelected(null));}}>Tutup periode</button>:null}{['SUPER_ADMIN','PAYROLL_CONTROLLER'].includes(role)&&selected.state==='CONTROLLER_REVIEW'?<button type="button" className="btn" onClick={()=>{const reason=window.prompt('Alasan meminta revisi payroll (minimal 10 karakter):');if(reason&&reason.trim().length>=10)void act({action:'TRANSITION_SUBMISSION',submissionId:selected.id,toState:'REVISION_REQUIRED',reviewNote:reason.trim()},'Pay Run dikembalikan ke Processor untuk revisi').then(()=>setSelected(null));}}>Minta revisi</button>:null}{next ? <button type="button" className="btn btn-primary" disabled={(reviewCheckpoint && !confirmed)||selected.input_status==='PENDING'} onClick={() => {const payload=next==='GENERATE_PAYMENT_INSTRUCTION'?{action:next,submissionId:selected.id}:next.startsWith('ADVANCE_')?{action:'ADVANCE_PAY_RUN',submissionId:selected.id,command:next==='ADVANCE_VALIDATE'?'VALIDATE':next==='ADVANCE_FINALIZE'?'FINALIZE_PAYROLL':'VALIDATE',reviewConfirmed:true,reviewNote:reviewNote||undefined}:selected.state==='CONTROLLER_REVIEW'?{action:'TRANSITION_SUBMISSION',submissionId:selected.id,toState:next,reviewConfirmed:true,reviewNote:reviewNote||undefined}:{action:'TRANSITION_SUBMISSION',submissionId:selected.id,toState:next};void act(payload,next==='GENERATE_PAYMENT_INSTRUCTION'?'Payment Instruction draft berhasil dibuat':`${actionName(selected.state)} berhasil`).then(()=>setSelected(null));}}>{actionName(selected.state)}</button> : null}</div>
    </div>
  </div>, document.body)}</>;
}

function PayRunUpload({submission,onImported}:{submission:any;onImported:(total:number)=>Promise<void>}) {
  const inputRef=useRef<HTMLInputElement>(null); const [rows,setRows]=useState<any[]>([]); const [fileName,setFileName]=useState('');
  const [busy,setBusy]=useState(false); const [error,setError]=useState('');
  const totals=rows.reduce((sum,row)=>({gross:sum.gross+Number(row.grossPay||0),deduction:sum.deduction+Number(row.totalDeductions||0),net:sum.net+Number(row.netPay||0)}),{gross:0,deduction:0,net:0});
  async function choose(file:File){setBusy(true);setError('');try{if(file.size>5*1024*1024)throw new Error('Ukuran file maksimal 5 MB');const {parseIapWorkbook}=await import('@/lib/excel-iap');const parsed=await parseIapWorkbook(await file.arrayBuffer());if(!parsed.rows.length)throw new Error('Tidak ada baris payroll valid pada file');setRows(parsed.rows);setFileName(file.name);}catch(cause){setRows([]);setError(cause instanceof Error?cause.message:'File tidak dapat dibaca');}finally{setBusy(false);}}
  async function upload(){setBusy(true);setError('');try{const response=await fetch('/api/import',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({rows,context:{submissionId:submission.id,clientId:submission.client_id,projectId:submission.project_id,servicePlanId:submission.service_plan_id,tier:submission.service_tier,period:submission.period}})});const payload=await response.json();if(!response.ok||payload.error)throw new Error(payload.error||`HTTP ${response.status}`);await onImported(Number(payload.total||rows.length));}catch(cause){setError(cause instanceof Error?cause.message:'Upload payroll gagal');setBusy(false);}}
  return <section className="pay-run-upload"><div><strong>Upload payroll final klien</strong><span>Format Excel IAP (.xlsx/.xls), maksimal 5 MB. File mengganti snapshot DRAFT ini—tidak membuat Pay Run baru.</span></div><input ref={inputRef} type="file" accept=".xlsx,.xls" hidden onChange={(event)=>{const file=event.target.files?.[0];if(file)void choose(file);}}/><button type="button" className="btn" disabled={busy} onClick={()=>inputRef.current?.click()}>{busy?'Memproses…':rows.length?'Ganti file':'Pilih file payroll'}</button>{rows.length?<div className="pay-run-upload-preview"><span>{fileName}</span><strong>{rows.length} penerima</strong><span>Gross {formatIDR(totals.gross)}</span><span>Potongan {formatIDR(totals.deduction)}</span><span>THP {formatIDR(totals.net)}</span><button type="button" className="btn btn-primary" disabled={busy||totals.net<=0} onClick={()=>void upload()}>Gunakan sebagai input Pay Run</button></div>:null}{error?<div className="app-notice-bubble app-notice-error" role="alert"><strong>File tidak dapat diproses</strong><span>{error}</span><button type="button" aria-label="Tutup pesan" onClick={()=>setError('')}>✕</button></div>:null}</section>;
}

function PayRunLineTable({detail,editable,onEdit}:{detail:any;editable:boolean;onEdit:(line:any,gross:number,deduction:number,included:boolean)=>Promise<void>}) {
  const allLines=detail.lines||[]; const detailsRef=useRef<HTMLDetailsElement>(null);
  const [query,setQuery]=useState(''); const [issueFilter,setIssueFilter]=useState('ALL'); const [page,setPage]=useState(1); const size=10;
  const issueFor=(line:any)=>Number(line.net_amount||0)<=0?'THP':Number(line.gross_amount||0)<=0?'GROSS':(!line.bank_name||!line.account_last4)?'BANK':'';
  const issueCounts=allLines.reduce((counts:Record<string,number>,line:any)=>{const issue=issueFor(line);if(issue)counts[issue]=(counts[issue]||0)+1;return counts;},{THP:0,GROSS:0,BANK:0});
  const totalIssues=Object.values(issueCounts as Record<string,number>).reduce<number>((sum,value)=>sum+value,0);
  const rows=allLines.filter((line:any)=>(issueFilter==='ALL'||issueFor(line)===issueFilter)&&(!query||[line.employee_name,line.employee_code,line.employee_id].join(' ').toLowerCase().includes(query.toLowerCase())));
  const pages=Math.max(1,Math.ceil(rows.length/size)); const visible=rows.slice((page-1)*size,page*size);
  function focusIssue(issue:string){setIssueFilter(issue);setQuery('');setPage(1);if(detailsRef.current)detailsRef.current.open=true;}
  function edit(line:any){const gross=window.prompt(`Gross ${line.employee_name}:`,String(line.gross_amount||0));if(gross===null)return;const deduction=window.prompt(`Potongan ${line.employee_name}:`,String(line.deduction_amount||0));if(deduction===null)return;const grossNumber=Number(gross),deductionNumber=Number(deduction);if(!Number.isSafeInteger(grossNumber)||!Number.isSafeInteger(deductionNumber)||grossNumber<deductionNumber||deductionNumber<0){window.alert('Nominal tidak valid. Gunakan angka bulat dan gross harus lebih besar atau sama dengan potongan.');return;}void onEdit(line,grossNumber,deductionNumber,line.included!==0);}
  return <><section className={`pay-run-readiness ${totalIssues?'has-issues':'ready'}`}><div><span>AI DATA READINESS</span><strong>{totalIssues?`${totalIssues} data harus diperbaiki`:'Semua data utama siap'}</strong><small>{totalIssues?'Pilih kategori untuk melihat record dan rekomendasi perbaikan.':'THP dan rekening penerima telah lolos pemeriksaan dasar.'}</small></div>{totalIssues?<div className="pay-run-readiness-actions">{issueCounts.THP?<button type="button" onClick={()=>focusIssue('THP')}><b>{issueCounts.THP}</b><span>THP kosong/nol</span><small>Edit nominal →</small></button>:null}{issueCounts.GROSS?<button type="button" onClick={()=>focusIssue('GROSS')}><b>{issueCounts.GROSS}</b><span>Gross kosong</span><small>Edit nominal →</small></button>:null}{issueCounts.BANK?<button type="button" onClick={()=>focusIssue('BANK')}><b>{issueCounts.BANK}</b><span>Rekening belum lengkap</span><small>Buka karyawan →</small></button>:null}</div>:null}</section><details ref={detailsRef} className="pay-run-lines" open={Boolean(totalIssues)}><summary>{issueFilter==='ALL'?'Preview seluruh penerima':`Filter masalah: ${issueFilter}`} <b>{rows.length}</b></summary><div className="pay-run-line-toolbar"><input value={query} placeholder="Cari nama atau ID karyawan" onChange={(event)=>{setQuery(event.target.value);setPage(1);}}/><select value={issueFilter} onChange={(event)=>{setIssueFilter(event.target.value);setPage(1);}}><option value="ALL">Semua penerima</option><option value="THP">THP kosong/nol</option><option value="GROSS">Gross kosong</option><option value="BANK">Rekening belum lengkap</option></select><span>Halaman {Math.min(page,pages)}/{pages}</span></div><div className="pay-run-line-scroll"><table><thead><tr><th>Karyawan</th><th>Gross</th><th>Potongan</th><th>THP</th><th>Masalah & rekomendasi</th><th>Aksi</th></tr></thead><tbody>{visible.map((line:any)=>{const issue=issueFor(line);return <tr key={line.id} className={issue?'pay-run-line-issue':''}><td><strong>{line.employee_name}</strong><small>{line.employee_code||line.employee_id} · {line.bank_name||'Bank belum ada'} ••••{line.account_last4||'----'}</small></td><td>{formatIDR(Number(line.gross_amount||0))}</td><td>{formatIDR(Number(line.deduction_amount||0))}</td><td><strong>{formatIDR(Number(line.net_amount||0))}</strong></td><td>{issue?<><Badge text="CRITICAL"/><small>{issue==='BANK'?'Lengkapi bank dan nomor rekening utama pada master karyawan.':'Isi gross dan potongan yang benar agar THP dapat dihitung.'}</small></>:<><Badge text="READY"/><small>Data utama siap diproses.</small></>}</td><td>{issue==='BANK'?<a className="btn" href={`?view=employees&employeeQuery=${encodeURIComponent(line.employee_code||line.employee_id)}`}>Perbaiki rekening</a>:editable?<button type="button" className="btn btn-primary" onClick={()=>edit(line)}>Edit nominal</button>:<span>Review only</span>}</td></tr>})}</tbody></table></div><div className="control-pagination"><span>{rows.length} ditampilkan · {totalIssues} masalah ditemukan</span><div><button className="btn" disabled={page<=1} onClick={()=>setPage((value)=>value-1)}>←</button><button className="btn" disabled={page>=pages} onClick={()=>setPage((value)=>value+1)}>→</button></div></div></details></>;
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

function Payments({ instructions, proofs, reconciliations, role, canReview, canApprove, act }: { instructions:any[]; proofs:any[]; reconciliations:any[]; role:string; canReview:boolean; canApprove:boolean; act:(p:Record<string,unknown>,s:string)=>Promise<void> }) {
  const [proofFor, setProofFor] = useState<string | null>(null);
  const [proof, setProof] = useState({ bank:'BCA', reference:'', transactionDate:new Date().toISOString().slice(0,10), amount:'' });
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [detail, setDetail] = useState<any | null>(null);
  const [detailError, setDetailError] = useState('');
  const [detailLoading, setDetailLoading] = useState(false);
  const [approvalConfirmed, setApprovalConfirmed] = useState(false);
  const [detailQuery, setDetailQuery] = useState('');
  const [detailBank, setDetailBank] = useState('ALL');
  const [detailPage, setDetailPage] = useState(1);
  const detailLines = useMemo(() => detail?.lines || [], [detail]);
  const bankSummaries = useMemo(() => {
    const summaries = new Map<string, { count:number; total:number }>();
    detailLines.forEach((line:any) => {
      const bank = String(line.bank_code || line.bank_name || 'LAINNYA').toUpperCase();
      const current = summaries.get(bank) || { count:0, total:0 };
      summaries.set(bank, { count:current.count + 1, total:current.total + Number(line.amount || 0) });
    });
    return [...summaries.entries()].sort((a,b) => b[1].total - a[1].total);
  }, [detailLines]);
  const filteredDetailLines = useMemo(() => detailLines.filter((line:any) => {
    const bank = String(line.bank_code || line.bank_name || 'LAINNYA').toUpperCase();
    const haystack = [line.beneficiary_name,line.employee_id,line.account_last4,bank].join(' ').toLowerCase();
    return (detailBank === 'ALL' || bank === detailBank) && (!detailQuery.trim() || haystack.includes(detailQuery.trim().toLowerCase()));
  }), [detailLines, detailBank, detailQuery]);
  const detailPageSize = 25;
  const detailPageCount = Math.max(1, Math.ceil(filteredDetailLines.length / detailPageSize));
  const visibleDetailLines = filteredDetailLines.slice((detailPage - 1) * detailPageSize, detailPage * detailPageSize);
  useEffect(() => { setDetailPage(1); }, [detailQuery, detailBank]);
  useEffect(() => {
    if (!detail) return;
    const close = (event:KeyboardEvent) => { if (event.key === 'Escape') setDetail(null); };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [detail]);
  async function openDetail(id:string) {
    setDetailLoading(true); setDetailError(''); setApprovalConfirmed(false); setDetailQuery(''); setDetailBank('ALL'); setDetailPage(1);
    try { setDetail(await getPaymentInstructionDetail(id)); }
    catch (error) { setDetailError(error instanceof Error ? error.message : 'Detail PI gagal dimuat'); }
    finally { setDetailLoading(false); }
  }
  if (!instructions.length) return <Empty title="Belum ada payment instruction" detail="Payment instruction akan tersedia setelah payroll selesai divalidasi dan disetujui." />;
  return <div style={{ display:'grid', gap:16 }}>
    <CardTable headers={['Instruction / Periode','Nilai','Status','Dibuat','Aksi']} rows={instructions.map((r) => {
      let action: React.ReactNode = <span style={small}>Menunggu tahap berikutnya</span>;
      if (r.status === 'PAYMENT_INSTRUCTION_READY') action = ['SUPER_ADMIN','PAYROLL_PROCESSOR'].includes(role)
        ? <button style={actionButton} onClick={() => void act({action:'SUBMIT_PAYMENT_INSTRUCTION',paymentInstructionId:r.id,confirmation:'SUBMIT PI'},'PI dikirim ke Controller untuk approval')}>Submit PI</button>
        : <button style={actionButton} onClick={() => void openDetail(r.id)}>Preview PI</button>;
      else if (r.status === 'PAYMENT_APPROVAL_PENDING') action = canApprove
        ? <button style={actionButton} onClick={() => void openDetail(r.id)}>Preview & Approve</button>
        : <button style={actionButton} onClick={() => void openDetail(r.id)}>Preview PI</button>;
      else if (canReview && ['APPROVED_FOR_PAYMENT','DISBURSEMENT_PROCESSING'].includes(r.status)) action = <button style={actionButton} onClick={() => { setProofFor(r.id); setProof((p) => ({ ...p, amount:String(r.expected_total || '') })); }}>Catat Bukti</button>;
      else if (canReview && r.status === 'PROOF_UPLOADED') action = <button style={actionButton} onClick={() => void act({ action:'RECONCILE_PAYMENT', paymentInstructionId:r.id }, 'Rekonsiliasi selesai')}>Rekonsiliasi</button>;
      else if (r.status === 'REVISION_REQUIRED') action = ['SUPER_ADMIN','PAYROLL_PROCESSOR'].includes(role)
        ? <a className="btn btn-primary" href={`?view=operations&submissionId=${encodeURIComponent(r.submission_id)}`}>Perbaiki Pay Run</a>
        : <button style={actionButton} onClick={() => void openDetail(r.id)}>Lihat alasan reject</button>;
      else action = <button style={actionButton} onClick={() => void openDetail(r.id)}>Detail PI</button>;
      return [<div key="id"><strong>{r.document_no || r.client_name || r.id}</strong><small style={small}>{r.client_name || '-'} · Payroll {r.payroll_period || '-'} · Bayar {r.payment_period || r.payroll_period || '-'}</small>{r.status === 'REVISION_REQUIRED' && r.rejection_reason?<small style={{...small,color:'#b91c1c'}}>Reject: {r.rejection_reason}</small>:null}</div>, formatIDR(Number(r.expected_total || 0)), <Badge key="status" text={r.status} />, date(r.created_at), <span key="action">{action}</span>];
    })} />
    {detailLoading ? <div className="card" style={{padding:18}}>Memuat snapshot Payment Instruction…</div> : null}
    {detailError ? <div className="app-notice-bubble app-notice-error" role="alert"><strong>Detail PI gagal</strong><span>{detailError}</span></div> : null}
    {detail ? createPortal(<div className="directory-modal-backdrop pi-detail-backdrop" onMouseDown={(event)=>{if(event.target===event.currentTarget)setDetail(null);}}><div className="directory-modal pi-detail-modal" role="dialog" aria-modal="true" aria-label="Detail Payment Instruction">
      <header className="pi-detail-header">
        <div><span>IMMUTABLE PAYMENT SNAPSHOT</span><h3>{detail.paymentInstruction.document_no || detail.paymentInstruction.id}</h3><p>{detail.paymentInstruction.client_name || 'Klien tidak tersedia'} · Dibuat {detail.paymentInstruction.creator_email || 'System'} · {date(detail.paymentInstruction.created_at)}</p></div>
        <div className="pi-detail-header-actions"><Badge text={detail.paymentInstruction.status} /><button type="button" aria-label="Tutup detail Payment Instruction" onClick={()=>setDetail(null)}>✕</button></div>
      </header>
      <div className="pi-detail-body">
        <section className="pi-detail-summary" aria-label="Ringkasan Payment Instruction">
          <div><span>Periode payroll</span><strong>{detail.paymentInstruction.payroll_period || '-'}</strong></div>
          <div><span>Periode bayar</span><strong>{detail.paymentInstruction.payment_period || detail.paymentInstruction.payroll_period || '-'}</strong></div>
          <div><span>Total penerima</span><strong>{Number(detail.control.recipientCount || 0).toLocaleString('id-ID')}</strong></div>
          <div className="pi-detail-total"><span>Control total</span><strong>{formatIDR(detail.control.totalAmount)}</strong></div>
        </section>
        <section className={`pi-integrity-panel ${detail.control.balanced && detail.paymentInstruction.content_hash ? 'pi-integrity-valid' : 'pi-integrity-warning'}`}>
          <div><strong>{detail.control.balanced ? '✓ Control total seimbang' : '⛔ Control total tidak seimbang'}</strong><span>Expected {formatIDR(detail.control.expectedTotal)} · Snapshot {formatIDR(detail.control.totalAmount)} · Selisih {formatIDR(detail.control.totalAmount - detail.control.expectedTotal)}</span></div>
          <div><strong>{detail.paymentInstruction.content_hash ? '✓ Snapshot terverifikasi' : '⚠ Snapshot legacy'}</strong><span>{detail.paymentInstruction.content_hash ? `SHA-256 · ${detail.paymentInstruction.content_hash}` : 'Content hash tidak tersedia; regenerasi PI diperlukan untuk approval.'}</span></div>
        </section>
        {detail.paymentInstruction.rejection_reason ? <section className={`app-notice-bubble ${detail.paymentInstruction.status==='REVISION_REQUIRED'?'app-notice-error':'app-notice-info'}`} role="status"><strong>{detail.paymentInstruction.status==='REVISION_REQUIRED'?'PI dikembalikan untuk revisi':'Riwayat reject sebelumnya'}</strong><span>{detail.paymentInstruction.rejection_reason} · {detail.paymentInstruction.rejected_by || 'Payroll Controller'}</span></section> : null}
        <section className="pi-bank-section" aria-label="Breakdown bank">
          <div className="pi-section-heading"><div><span>DISTRIBUSI PEMBAYARAN</span><h4>Ringkasan per bank</h4></div><small>{bankSummaries.length} bank · {detailLines.length.toLocaleString('id-ID')} transaksi</small></div>
          <div className="pi-bank-grid">{bankSummaries.map(([bank,summary])=><button type="button" key={bank} className={detailBank===bank?'active':''} onClick={()=>setDetailBank(detailBank===bank?'ALL':bank)}><span>{bank}</span><strong>{formatIDR(summary.total)}</strong><small>{summary.count.toLocaleString('id-ID')} penerima</small></button>)}</div>
        </section>
        <section className="pi-recipient-section" aria-label="Daftar penerima">
          <div className="pi-section-heading"><div><span>BENEFICIARY CONTROL</span><h4>Daftar penerima</h4></div><small>Menampilkan {visibleDetailLines.length} dari {filteredDetailLines.length.toLocaleString('id-ID')}</small></div>
          <div className="pi-recipient-toolbar">
            <input aria-label="Cari penerima" value={detailQuery} onChange={(event)=>setDetailQuery(event.target.value)} placeholder="Cari nama, ID karyawan, rekening…" />
            <select aria-label="Filter bank penerima" value={detailBank} onChange={(event)=>setDetailBank(event.target.value)}><option value="ALL">Semua bank</option>{bankSummaries.map(([bank])=><option key={bank} value={bank}>{bank}</option>)}</select>
          </div>
          <div className="pi-recipient-table-wrap"><table className="pi-recipient-table"><thead><tr><th>Penerima</th><th>Bank</th><th>Rekening</th><th>Nominal</th></tr></thead><tbody>{visibleDetailLines.map((line:any,index:number)=><tr key={`${line.employee_id || line.beneficiary_name}-${index}`}><td data-label="Penerima"><strong>{line.beneficiary_name || '-'}</strong><small>{line.employee_id || 'ID tidak tersedia'}</small></td><td data-label="Bank">{line.bank_code || line.bank_name || '-'}</td><td data-label="Rekening"><span className="pi-account-mask">•••• {line.account_last4 || '----'}</span></td><td data-label="Nominal"><strong>{formatIDR(Number(line.amount || 0))}</strong></td></tr>)}</tbody></table>{!visibleDetailLines.length?<div className="directory-empty">Penerima tidak ditemukan.</div>:null}</div>
          <div className="pi-pagination"><span>Halaman {Math.min(detailPage,detailPageCount)} dari {detailPageCount}</span><div><button className="btn" disabled={detailPage<=1} onClick={()=>setDetailPage((page)=>page-1)}>← Sebelumnya</button><button className="btn" disabled={detailPage>=detailPageCount} onClick={()=>setDetailPage((page)=>page+1)}>Berikutnya →</button></div></div>
        </section>
        <section className="pi-approval-section"><div className="pi-section-heading"><div><span>GOVERNANCE</span><h4>Approval trail</h4></div><small>{detail.approvals?.length || 0} aktivitas</small></div>{detail.approvals?.length ? <div className="pi-approval-list">{detail.approvals.map((approval:any)=><div key={approval.id}><i>✓</i><div><strong>{String(approval.status || '').replaceAll('_',' ')}</strong><span>{approval.approver_email || approval.approver_user_id || 'System'} · {date(approval.created_at)}</span></div></div>)}</div> : <p className="directory-hint">Belum ada approval yang tercatat.</p>}</section>
      </div>
      <footer className="pi-detail-footer">
        <div className="pi-export-actions"><a className="btn" href={`/api/payment-instruction-export?id=${encodeURIComponent(detail.paymentInstruction.id)}&format=PDF`} target="_blank" rel="noreferrer">Unduh PDF resmi</a>{['APPROVED_FOR_PAYMENT','DISBURSEMENT_PROCESSING','PROOF_UPLOADED','COMPLETED'].includes(detail.paymentInstruction.status) ? ['BCA','MANDIRI','BRI','BNI','CUSTOM'].map((format)=><a key={format} className="btn" href={`/api/payment-instruction-export?id=${encodeURIComponent(detail.paymentInstruction.id)}&format=${format}`}>{format}</a>) : null}</div>
        {detail.paymentInstruction.status === 'PAYMENT_APPROVAL_PENDING' && canApprove ? <div className="pi-approve-actions"><label className="payroll-review-confirm"><input type="checkbox" checked={approvalConfirmed} onChange={(event)=>setApprovalConfirmed(event.target.checked)} /><span>Saya sudah memeriksa penerima, rekening, nominal, control total, dan content hash.</span></label><button className="btn" onClick={()=>{const reason=window.prompt('Alasan penolakan PI (minimal 10 karakter):');if(reason)void act({action:'REJECT_PAYMENT',paymentInstructionId:detail.paymentInstruction.id,reason},'PI dikembalikan ke Processor untuk revisi').then(()=>setDetail(null));}}>Reject PI</button><button className="btn btn-primary" disabled={!approvalConfirmed || !detail.control.balanced || !detail.paymentInstruction.content_hash} onClick={()=>void act({action:'APPROVE_PAYMENT',paymentInstructionId:detail.paymentInstruction.id,actionHash:detail.paymentInstruction.content_hash,confirmation:'KONFIRMASI PAYMENT'},'Payment Instruction disetujui berdasarkan content hash').then(()=>setDetail(null))}>Approve PI</button></div> : null}
      </footer>
    </div></div>, document.body) : null}
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
        const connection = rows.find((row) => row.connector_type === type);
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
const actionButton: React.CSSProperties = { border:0, borderRadius:8, background:'var(--accent)', color:'var(--accent-contrast)', padding:'7px 11px', fontSize:11, fontWeight:650, cursor:'pointer', whiteSpace:'nowrap' };
const input: React.CSSProperties = { border:'1px solid var(--border)', borderRadius:8, background:'var(--bg-surface)', color:'var(--text)', padding:'9px 10px', fontSize:12, minWidth:0 };

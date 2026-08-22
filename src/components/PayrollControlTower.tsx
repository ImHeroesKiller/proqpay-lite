'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AppView } from './Sidebar';
import { formatIDR, formatIDRShort } from '@/lib/format';
import { invalidateOperatingCache, listOperatingDashboard } from '@/lib/operating-model-api';
import { IconAlertTriangle, IconCheckCircle, IconClock, IconLayers, IconRefresh, IconShieldCheck, IconWallet } from './Icons';

type Actor = { email:string; role:string; permissions:string[]; clientIds?:string[]|null };
type Props = { actor:Actor; period:string; onNavigate:(view:AppView)=>void };
type Tone = 'danger'|'warning'|'info'|'success';
type PortfolioSummary = { clients:number;projects:number;employees:number;activeEmployees:number;primaryAccounts:number;bankCoveragePercent:number };
type DashboardData = { submissions?:any[];exceptions?:any[];paymentInstructions?:any[];paymentProofs?:any[];reconciliations?:any[];portfolioSummary?:Partial<PortfolioSummary> };

const DONE_STATES = new Set(['COMPLETED','RECONCILIATION','MATCHED','CLOSED']);
const PIPELINE:Array<{label:string;description:string;states:string[];view:AppView}> = [
  {
    label:'Data Readiness',
    description:'Master & AI validation',
    states:['DRAFT','SUBMITTED','INGESTING','AI_VALIDATING','VALIDATED','EXCEPTION_FOUND','CLIENT_ACTION_REQUIRED','CLIENT_RESUBMITTED'],
    view:'operations',
  },
  {
    label:'Payroll Processing',
    description:'Calculate & finalize',
    states:['STANDARDIZED','CALCULATED','PROCESSOR_REVIEW','PAYROLL_FINALIZED','REVISION_REQUIRED','CONTROLLER_REVIEW','DATA_APPROVED'],
    view:'operations',
  },
  {
    label:'PI Preparation',
    description:'Generate & submit PI',
    states:['PAYMENT_INSTRUCTION_READY','PAYMENT_APPROVAL_PENDING'],
    view:'payments',
  },
  {
    label:'Approval & Payment',
    description:'Approve & transfer',
    states:['APPROVED_FOR_PAYMENT','DISBURSEMENT_PROCESSING','PROOF_UPLOADED','PAYMENT_CONFIRMED'],
    view:'payments',
  },
  {
    label:'Reconciliation & Billing',
    description:'Match, invoice & close',
    states:['RECONCILIATION','MATCHED','COMPLETED','CLOSED'],
    view:'billing',
  },
];

function dateLabel(value:string) { return value ? new Date(value).toLocaleDateString('id-ID',{day:'2-digit',month:'short'}) : '-'; }
function statusLabel(value:string) { return String(value||'-').replaceAll('_',' '); }
function stageFor(state:string) { return PIPELINE.find((stage)=>stage.states.includes(state))?.label || 'Payroll Processing'; }
function daysFromNow(value:string) { return Math.ceil((new Date(value).getTime()-Date.now())/86_400_000); }

export default function PayrollControlTower({actor,period,onNavigate}:Props) {
  const [data,setData] = useState<DashboardData>({});
  const [loading,setLoading] = useState(true);
  const [error,setError] = useState('');
  const [client,setClient] = useState('ALL');
  const [status,setStatus] = useState('ALL');
  const [tier,setTier] = useState('ALL');
  const [query,setQuery] = useState('');
  const [page,setPage] = useState(1);

  const load = useCallback(async()=>{
    setLoading(true); setError('');
    try {
      const scopedClientIds=actor.role==='CLIENT_USER'?(actor.clientIds||[]):[undefined];
      const results=await Promise.all(scopedClientIds.map((clientId)=>listOperatingDashboard(clientId)));
      const merged:Record<string,any>={};
      results.forEach((result)=>Object.entries(result).forEach(([key,value])=>{
        if(Array.isArray(value)) merged[key]=[...(merged[key]||[]),...value];
        else if(key==='portfolioSummary'&&value&&typeof value==='object') {
          const previous=merged[key]||{}; const current=value as Record<string,number>;
          merged[key]={clients:Number(previous.clients||0)+Number(current.clients||0),projects:Number(previous.projects||0)+Number(current.projects||0),employees:Number(previous.employees||0)+Number(current.employees||0),activeEmployees:Number(previous.activeEmployees||0)+Number(current.activeEmployees||0),primaryAccounts:Number(previous.primaryAccounts||0)+Number(current.primaryAccounts||0)};
        }
      }));
      if(merged.portfolioSummary){const summary=merged.portfolioSummary;summary.bankCoveragePercent=summary.employees?Math.round((summary.primaryAccounts/summary.employees)*100):0;}
      setData(merged);
    } catch (loadError) { setError(loadError instanceof Error?loadError.message:'Dashboard operasional gagal dimuat'); }
    finally { setLoading(false); }
  },[actor.clientIds,actor.role]);
  useEffect(()=>{void load();},[load]);

  const submissions=useMemo(()=>data.submissions||[],[data.submissions]);
  const instructions=useMemo(()=>data.paymentInstructions||[],[data.paymentInstructions]);
  const proofs=useMemo(()=>data.paymentProofs||[],[data.paymentProofs]);
  const exceptions=useMemo(()=>data.exceptions||[],[data.exceptions]);
  const reconciliations=useMemo(()=>data.reconciliations||[],[data.reconciliations]);
  const portfolio=data.portfolioSummary||{};
  const instructionBySubmission=useMemo(()=>new Map(instructions.map((row)=>[row.submission_id,row])),[instructions]);
  const reconciliationByInstruction=useMemo(()=>new Map(reconciliations.map((row)=>[row.payment_instruction_id,row])),[reconciliations]);
  const operationalSubmissions=useMemo(()=>submissions.map((row)=>{
    const instruction=instructionBySubmission.get(row.id);
    const reconciliation=instruction?reconciliationByInstruction.get(instruction.id):null;
    const operationalState=reconciliation?.status==='MATCHED'?'COMPLETED':instruction?.status||row.state;
    return {...row,state:operationalState,submission_state:row.state,payment_instruction_id:instruction?.id};
  }),[submissions,instructionBySubmission,reconciliationByInstruction]);
  const clients=useMemo(()=>{
    const map=new Map<string,string>(); operationalSubmissions.forEach((row)=>map.set(String(row.client_id),String(row.client_name||row.client_id)));
    return [...map.entries()].sort((a,b)=>a[1].localeCompare(b[1]));
  },[operationalSubmissions]);
  const statuses=useMemo(()=>[...new Set(operationalSubmissions.map((row)=>String(row.state||'')).filter(Boolean))].sort(),[operationalSubmissions]);
  const tiers=useMemo(()=>[...new Set(operationalSubmissions.map((row)=>String(row.service_tier||'')).filter(Boolean))].sort(),[operationalSubmissions]);
  const visible=useMemo(()=>operationalSubmissions.filter((row)=>{
    const haystack=[row.client_name,row.project_name,row.period,row.payment_period,row.state,row.id].join(' ').toLowerCase();
    return (period==='ALL'||row.period===period||row.payment_period===period)
      &&(client==='ALL'||row.client_id===client)&&(status==='ALL'||row.state===status)
      &&(tier==='ALL'||row.service_tier===tier)&&(!query.trim()||haystack.includes(query.trim().toLowerCase()));
  }),[operationalSubmissions,period,client,status,tier,query]);
  const visibleIds=useMemo(()=>new Set(visible.map((row)=>row.id)),[visible]);
  const visibleInstructions=useMemo(()=>instructions.filter((row)=>visibleIds.has(row.submission_id)),[instructions,visibleIds]);
  const visibleInstructionIds=useMemo(()=>new Set(visibleInstructions.map((row)=>row.id)),[visibleInstructions]);
  const visibleProofs=useMemo(()=>proofs.filter((row)=>visibleInstructionIds.has(row.payment_instruction_id)),[proofs,visibleInstructionIds]);
  const visibleReconciliations=useMemo(()=>reconciliations.filter((row)=>visibleInstructionIds.has(row.payment_instruction_id)),[reconciliations,visibleInstructionIds]);
  const visibleExceptions=useMemo(()=>exceptions.filter((row)=>visibleIds.has(row.submission_id)&&!['RESOLVED','ACCEPTED'].includes(row.status)),[exceptions,visibleIds]);

  const totalNet=visible.reduce((sum,row)=>sum+Number(row.total_net||0),0);
  const activeRuns=visible.filter((row)=>!DONE_STATES.has(row.state)).length;
  const blockers=visible.reduce((sum,row)=>sum+Number(row.blocking_count||0),0);
  const awaitingApproval=visible.filter((row)=>['PAYMENT_APPROVAL_PENDING','PAYMENT_INSTRUCTION_READY'].includes(row.state)).length;
  const matched=visibleReconciliations.filter((row)=>row.status==='MATCHED').length;
  const unmatched=visibleReconciliations.filter((row)=>row.status!=='MATCHED').length;

  const actions=useMemo(()=>{
    const list:Array<{id:string;tone:Tone;title:string;detail:string;client:string;amount:number;action:string;view:AppView}> = [];
    visible.forEach((row)=>{
      if(Number(row.blocking_count||0)>0) list.push({id:`block-${row.id}`,tone:'danger',title:`${row.blocking_count} blocker payroll`,detail:`${stageFor(row.state)} · ${statusLabel(row.state)}`,client:row.client_name||row.client_id,amount:Number(row.total_net||0),action:'Review exception',view:'operations'});
      else if(['PAYMENT_APPROVAL_PENDING','PAYMENT_INSTRUCTION_READY'].includes(row.state)) list.push({id:`approve-${row.id}`,tone:'warning',title:'PI menunggu approval',detail:`${stageFor(row.state)} · Payroll ${row.period}`,client:row.client_name||row.client_id,amount:Number(row.total_net||0),action:actor.role==='PAYROLL_CONTROLLER'?'Review PI':'Lihat status',view:'payments'});
      else if(!DONE_STATES.has(row.state)) list.push({id:`work-${row.id}`,tone:'info',title:'Workflow perlu dilanjutkan',detail:`${stageFor(row.state)} · ${statusLabel(row.state)}`,client:row.client_name||row.client_id,amount:Number(row.total_net||0),action:'Buka pay run',view:'operations'});
    });
    visibleReconciliations.filter((row)=>row.status!=='MATCHED').forEach((row)=>list.unshift({id:`rec-${row.id}`,tone:'danger',title:'Rekonsiliasi belum match',detail:`Selisih ${formatIDR(Number(row.difference||0))}`,client:'Payment control',amount:Number(row.difference||0),action:'Reconcile',view:'payments'}));
    return list.sort((a,b)=>({danger:0,warning:1,info:2,success:3}[a.tone]-{danger:0,warning:1,info:2,success:3}[b.tone]));
  },[visible,visibleReconciliations,actor.role]);

  const deadlines=useMemo(()=>visible.map((row)=>{
    const raw=row.payment_date||row.due_date||row.cutoff_date||row.payment_due_date;
    return {...row,deadline:raw,days:raw?daysFromNow(raw):null};
  }).filter((row)=>row.deadline).sort((a,b)=>new Date(a.deadline).getTime()-new Date(b.deadline).getTime()).slice(0,6),[visible]);
  const pipeline=PIPELINE.map((stage)=>({...stage,rows:visible.filter((row)=>stage.states.includes(row.state))}));
  const pipelineTotal=Math.max(1,visible.length);
  const pageCount=Math.max(1,Math.ceil(visible.length/10));
  const pageRows=visible.slice((page-1)*10,page*10);
  useEffect(()=>setPage(1),[period,client,status,tier,query]);
  const reset=()=>{setClient('ALL');setStatus('ALL');setTier('ALL');setQuery('');};

  return <section className="control-tower">
    <div className="control-tower-heading"><div><span>PAYROLL CONTROL TOWER</span><h1>Selamat datang, {actor.email.split('@')[0]}</h1><p>Prioritas, deadline, pembayaran, dan seluruh pay run dalam satu kendali.</p></div><button type="button" className="btn control-refresh" onClick={()=>{invalidateOperatingCache();void load();}}><IconRefresh aria-hidden="true" /> Refresh data</button></div>
    <div className="control-bar card">
      <label><span>Klien</span><select value={client} onChange={(event)=>setClient(event.target.value)}><option value="ALL">Semua klien</option>{clients.map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label>
      <label><span>Status</span><select value={status} onChange={(event)=>setStatus(event.target.value)}><option value="ALL">Semua status</option>{statuses.map((item)=><option key={item}>{item}</option>)}</select></label>
      <label><span>Service tier</span><select value={tier} onChange={(event)=>setTier(event.target.value)}><option value="ALL">Semua tier</option>{tiers.map((item)=><option key={item}>{statusLabel(item)}</option>)}</select></label>
      <label className="control-search"><span>Pencarian</span><input value={query} onChange={(event)=>setQuery(event.target.value)} placeholder="Klien, project, pay run…" /></label>
      <button type="button" onClick={reset}>Reset</button>
    </div>
    {error?<div className="app-notice-bubble app-notice-error"><strong>Dashboard gagal dimuat</strong><span>{error}</span></div>:null}
    {loading?<div className="card control-loading">Menyiapkan payroll control tower…</div>:<>
      <div className="portfolio-snapshot" aria-label="Ringkasan kesiapan master data">
        <span>Data readiness</span><b>{Number(portfolio.employees||0).toLocaleString('id-ID')} karyawan</b><i aria-hidden="true" />
        <b>{Number(portfolio.clients||0).toLocaleString('id-ID')} klien</b><i aria-hidden="true" />
        <b>{Number(portfolio.projects||0).toLocaleString('id-ID')} project</b><i aria-hidden="true" />
        <b>{Number(portfolio.bankCoveragePercent||0)}% rekening utama</b>
      </div>
      <div className="control-kpis">
        <Kpi label="Active pay runs" value={String(activeRuns)} note={`${visible.length} pay run terfilter`} tone="blue" icon={<IconLayers />} onClick={()=>onNavigate('operations')} />
        <Kpi label="Need attention" value={String(actions.filter((item)=>item.tone==='danger').length)} note={`${blockers} blocker aktif`} tone="red" icon={<IconAlertTriangle />} onClick={()=>onNavigate('operations')} />
        <Kpi label="Awaiting PI approval" value={String(awaitingApproval)} note="Menunggu Controller" tone="amber" icon={<IconClock />} onClick={()=>onNavigate('payments')} />
        <Kpi label="Payment due" value={formatIDRShort(totalNet)} note={`${visible.reduce((sum,row)=>sum+Number(row.employee_count||0),0).toLocaleString('id-ID')} penerima`} tone="navy" icon={<IconWallet />} featured onClick={()=>onNavigate('payments')} />
        <Kpi label="Paid & matched" value={String(matched)} note={`${unmatched} belum match`} tone="green" icon={<IconCheckCircle />} onClick={()=>onNavigate('reports')} />
        <Kpi label="Open exceptions" value={String(visibleExceptions.length)} note="Perlu diselesaikan" tone="violet" icon={<IconShieldCheck />} onClick={()=>onNavigate('operations')} />
      </div>
      <div className="control-priority-grid">
        <section className="card action-center"><PanelTitle eyebrow="PRIORITY QUEUE" title="Action Center" meta={`${actions.length} tindakan`} />
          <div className="action-list">{actions.length?actions.slice(0,8).map((item)=><button type="button" key={item.id} onClick={()=>onNavigate(item.view)}><i className={`action-tone ${item.tone}`} /><span><strong>{item.client}</strong><small>{item.title} · {item.detail}</small></span><b>{item.amount?formatIDRShort(item.amount):'-'}</b><em>{item.action} →</em></button>):<Empty text="Tidak ada pekerjaan kritis pada filter ini." />}</div>
        </section>
        <section className="card deadline-panel"><PanelTitle eyebrow="NEXT 30 DAYS" title="Deadline & SLA" meta={`${deadlines.length} agenda`} />
          <div className="deadline-list">{deadlines.length?deadlines.map((item)=><button type="button" key={item.id} onClick={()=>onNavigate('operations')}><time>{dateLabel(item.deadline)}</time><span><strong>{item.client_name||item.client_id}</strong><small>{stageFor(item.state)} · {statusLabel(item.state)}</small></span><b className={item.days!==null&&item.days<0?'overdue':''}>{item.days===null?'-':item.days<0?`${Math.abs(item.days)}h terlambat`:item.days===0?'Hari ini':`${item.days} hari`}</b></button>):<Empty text="Belum ada deadline operasional." />}</div>
        </section>
      </div>
      <section className="card pipeline-panel">
        <PanelTitle eyebrow="END-TO-END WORKFLOW" title="Payroll Pipeline" meta={`${visible.length} pay run`} />
        <div className="pipeline-grid">{pipeline.map((stage,index)=>{
          const share=Math.round((stage.rows.length/pipelineTotal)*100);
          const meterWidth=stage.rows.length?Math.max(8,share):0;
          const stageValue=stage.rows.reduce((sum,row)=>sum+Number(row.total_net||0),0);
          return <button type="button" key={stage.label} onClick={()=>onNavigate(stage.view)} aria-label={`${stage.label}: ${stage.rows.length} pay run, buka ${stage.view}`}>
            <span>{index+1}</span>
            <strong>{stage.rows.length}</strong>
            <small>{stage.label}</small>
            <div className="pipeline-stage-hint"><b>{stage.description}</b><span>{share}%</span></div>
            <div className="pipeline-meter" aria-hidden="true"><i style={{width:`${meterWidth}%`}} /></div>
            <em>{formatIDRShort(stageValue)} · Klik untuk buka</em>
          </button>;
        })}</div>
      </section>
      <section className="card portfolio-panel"><PanelTitle eyebrow="PORTFOLIO MONITORING" title="Pay Run Portfolio" meta={`${visible.length} record`} />
        <div className="portfolio-table-wrap"><table className="portfolio-table"><thead><tr><th>Klien / Project</th><th>Periode</th><th>Tier</th><th>Penerima</th><th>Net / THP</th><th>Blocker</th><th>Current stage</th><th>Next action</th></tr></thead><tbody>{pageRows.map((row)=><tr key={row.id}><td><strong>{row.client_name||row.client_id}</strong><small>{row.project_name||row.id}</small></td><td>{row.period}<small>Bayar {row.payment_period||row.period}</small></td><td>{statusLabel(row.service_tier).replace('TIER 1 ','T1 · ').replace('TIER 2 ','T2 · ').replace('TIER 3 ','T3 · ')}</td><td>{Number(row.employee_count||0).toLocaleString('id-ID')}</td><td><strong>{formatIDR(Number(row.total_net||0))}</strong></td><td><span className={Number(row.blocking_count||0)?'table-blocker':'table-clear'}>{Number(row.blocking_count||0)}</span></td><td><span className="stage-pill">{stageFor(row.state)}</span><small>{statusLabel(row.state)}</small></td><td><button type="button" onClick={()=>onNavigate('operations')}>Review →</button></td></tr>)}</tbody></table>{!pageRows.length?<Empty text="Tidak ada pay run sesuai filter." />:null}</div>
        <div className="control-pagination"><span>Halaman {Math.min(page,pageCount)} dari {pageCount}</span><div><button className="btn" disabled={page<=1} onClick={()=>setPage((value)=>value-1)}>←</button><button className="btn" disabled={page>=pageCount} onClick={()=>setPage((value)=>value+1)}>→</button></div></div>
      </section>
      <div className="control-bottom-grid"><section className="card payment-control"><PanelTitle eyebrow="PAYMENT INTEGRITY" title="Payment Control" meta={`${visibleInstructions.length} PI`} /><div className="payment-control-grid"><div><span>PI value</span><strong>{formatIDRShort(visibleInstructions.reduce((sum,row)=>sum+Number(row.expected_total||0),0))}</strong></div><div><span>Matched</span><strong>{matched}</strong></div><div><span>Proof tercatat</span><strong>{visibleProofs.length}</strong></div><div><span>Legacy hash</span><strong>{visibleInstructions.filter((row)=>!row.content_hash).length}</strong></div></div><button type="button" className="btn" onClick={()=>onNavigate('payments')}>Buka payment control</button></section>
        <section className="card trend-panel"><PanelTitle eyebrow="OPERATIONAL HEALTH" title="Performa periode" meta="Portfolio" /><div className="health-list"><div><span>On-track rate</span><strong>{visible.length?Math.round((visible.filter((row)=>!Number(row.blocking_count||0)).length/visible.length)*100):0}%</strong></div><div><span>Reconciliation match</span><strong>{visibleReconciliations.length?Math.round((matched/visibleReconciliations.length)*100):0}%</strong></div><div><span>Exception rate</span><strong>{visible.reduce((sum,row)=>sum+Number(row.employee_count||0),0)?((visibleExceptions.length/visible.reduce((sum,row)=>sum+Number(row.employee_count||0),0))*100).toFixed(1):'0.0'}%</strong></div></div><div className="role-focus"><span>{actor.role.replaceAll('_',' ')}</span><p>{roleFocus(actor.role)}</p></div></section></div>
    </>}
  </section>;
}

function Kpi({label,value,note,tone,icon,featured=false,onClick}:{label:string;value:string;note:string;tone:string;icon:React.ReactNode;featured?:boolean;onClick:()=>void}) { return <button type="button" className={`control-kpi ${tone}${featured?' featured':''}`} onClick={onClick}><span className="control-kpi-icon" aria-hidden="true">{icon}</span><span className="control-kpi-label">{label}</span><strong>{value}</strong><small>{note}</small><i aria-hidden="true">↗</i></button>; }
function PanelTitle({eyebrow,title,meta}:{eyebrow:string;title:string;meta:string}) { return <div className="control-panel-title"><div><span>{eyebrow}</span><h2>{title}</h2></div><small>{meta}</small></div>; }
function Empty({text}:{text:string}) { return <div className="control-empty">{text}</div>; }
function roleFocus(role:string) { return role==='PAYROLL_PROCESSOR'?'Prioritas Anda: Data Readiness, payroll processing, generate PI, dan submit PI untuk approval.':role==='PAYROLL_CONTROLLER'?'Prioritas Anda: review/approve PI, upload bukti transfer, rekonsiliasi, dan billing.':role==='CLIENT_USER'?'Prioritas Anda: memantau progress payroll, PI, bukti transfer, invoice, dan histori penyelesaian.':'Pantau seluruh klien, SLA, risiko, payment integrity, dan kesehatan sistem.'; }

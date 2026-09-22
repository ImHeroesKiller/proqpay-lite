'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AppView } from './Sidebar';
import { formatIDR, formatIDRShort } from '@/lib/format';
import { invalidateOperatingCache, listOperatingDashboard } from '@/lib/operating-model-api';
import { BUSINESS_STAGE_META, PAYROLL_BUSINESS_STAGE_ORDER, derivePayrollBusinessStage } from '@/lib/payroll-business-stage';
import { derivePayrollNextAction } from '@/lib/payroll-next-action';
import { IconAlertTriangle, IconCheckCircle, IconClock, IconLayers, IconRefresh, IconShieldCheck, IconWallet } from './Icons';

type Actor = { email:string; role:string; permissions:string[]; clientIds?:string[]|null };
type Props = { actor:Actor; period:string; onNavigate:(view:AppView)=>void };
type Tone = 'danger'|'warning'|'info'|'success';
type PortfolioSummary = { clients:number;projects:number;employees:number;activeEmployees:number;primaryAccounts:number;bankCoveragePercent:number };
type DashboardData = { submissions?:any[];paymentInstructions?:any[];portfolioSummary?:Partial<PortfolioSummary>;dashboardMeta?:{period?:string;submissionsTotal?:number;submissionsReturned?:number;truncated?:boolean} };

const PIPELINE = PAYROLL_BUSINESS_STAGE_ORDER.map((stage) => ({
  stage,
  label:BUSINESS_STAGE_META[stage].label,
  description:BUSINESS_STAGE_META[stage].description,
  view:BUSINESS_STAGE_META[stage].view as AppView,
}));

function localDate(value:string) {
  if (!value) return null;
  const match=String(value).slice(0,10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return new Date(Number(match[1]),Number(match[2])-1,Number(match[3]));
}
function dateLabel(value:string) { const date=localDate(value); return date ? date.toLocaleDateString('id-ID',{day:'2-digit',month:'short'}) : '-'; }
function statusLabel(value:string) { return String(value||'-').replaceAll('_',' '); }
function daysFromNow(value:string) {
  const target=localDate(value); if (!target) return null;
  const today=new Date(); today.setHours(0,0,0,0);
  return Math.round((target.getTime()-today.getTime())/86_400_000);
}

export default function PayrollControlTower({actor,period,onNavigate}:Props) {
  const [data,setData] = useState<DashboardData>({});
  const [loading,setLoading] = useState(true);
  const [error,setError] = useState('');
  const [client,setClient] = useState('ALL');
  const [status,setStatus] = useState('ALL');
  const [stage,setStage] = useState('ALL');
  const [tier,setTier] = useState('ALL');
  const [query,setQuery] = useState('');
  const [page,setPage] = useState(1);
  const [scopedPortfolio,setScopedPortfolio] = useState<Partial<PortfolioSummary>|null>(null);

  const load = useCallback(async()=>{
    setLoading(true); setError('');
    try {
      const scopedClientIds:[string|undefined]=[undefined];
      const results=await Promise.all(scopedClientIds.map((clientId)=>listOperatingDashboard(clientId,period)));
      const merged:Record<string,any>={};
      results.forEach((result)=>Object.entries(result).forEach(([key,value])=>{
        if(Array.isArray(value)) merged[key]=[...(merged[key]||[]),...value];
        else if(key==='dashboardMeta'&&value&&typeof value==='object') merged[key]=value;
        else if(key==='portfolioSummary'&&value&&typeof value==='object') {
          const previous=merged[key]||{}; const current=value as Record<string,number>;
          merged[key]={clients:Number(previous.clients||0)+Number(current.clients||0),projects:Number(previous.projects||0)+Number(current.projects||0),employees:Number(previous.employees||0)+Number(current.employees||0),activeEmployees:Number(previous.activeEmployees||0)+Number(current.activeEmployees||0),primaryAccounts:Number(previous.primaryAccounts||0)+Number(current.primaryAccounts||0)};
        }
      }));
      if(merged.portfolioSummary){const summary=merged.portfolioSummary;summary.bankCoveragePercent=summary.employees?Math.round((summary.primaryAccounts/summary.employees)*100):0;}
      setData(merged);
    } catch (loadError) { setError(loadError instanceof Error?loadError.message:'Dashboard operasional gagal dimuat'); }
    finally { setLoading(false); }
  },[actor.clientIds,actor.role,period]);
  useEffect(()=>{void load();},[load]);

  const submissions=useMemo(()=>data.submissions||[],[data.submissions]);
  const instructions=useMemo(()=>data.paymentInstructions||[],[data.paymentInstructions]);
  const portfolio=(client!=='ALL'&&scopedPortfolio) ? scopedPortfolio : (data.portfolioSummary||{});
  const simplifiedInternal=['PAYROLL_PROCESSOR','PAYROLL_CONTROLLER'].includes(actor.role);
  const workspaceTitle=actor.role==='PAYROLL_CONTROLLER'?'Approval Workspace':actor.role==='PAYROLL_PROCESSOR'?'Payroll Workspace':'Payroll Control Tower';
  const workspaceDescription=actor.role==='PAYROLL_CONTROLLER'
    ? 'Review hanya item yang membutuhkan approval atau kontrol Anda.'
    : actor.role==='PAYROLL_PROCESSOR'
      ? 'Kerjakan payroll berdasarkan prioritas dan next action yang tersedia.'
      : 'Prioritas, deadline, pembayaran, dan seluruh pay run dalam satu kendali.';
  const instructionBySubmission=useMemo(()=>{
    const map=new Map<string,any>();
    instructions.forEach((row)=>{ if(!map.has(String(row.submission_id))) map.set(String(row.submission_id),row); });
    return map;
  },[instructions]);
  const operationalSubmissions=useMemo(()=>submissions.map((row)=>{
    const instruction=instructionBySubmission.get(row.id);
    const operationalState=row.reconciliation_status==='MATCHED'?'COMPLETED':instruction?.status||row.state;
    const businessContext={
      role:actor.role,
      permissions:actor.permissions,
      state:row.state,
      paymentInstructionStatus:instruction?.status,
      reconciliationStatus:row.reconciliation_status,
      blockingCount:row.blocking_count,
      exceptionCount:row.exception_count,
      invoiceStatus:row.invoice_status,
      arStatus:row.ar_status,
      inputStatus:row.input_status,
      sourceMode:row.source_mode,
      periodStatus:row.period_status,
      hasPaymentInstruction:Boolean(instruction),
      paymentInstructionId:instruction?.id,
    };
    const business=derivePayrollBusinessStage(businessContext);
    const nextAction=derivePayrollNextAction(businessContext);
    return {...row,state:operationalState,submission_state:row.state,payment_instruction_id:instruction?.id,business,nextAction};
  }),[submissions,instructionBySubmission,actor.role,actor.permissions]);
  const clients=useMemo(()=>{
    const map=new Map<string,string>(); operationalSubmissions.forEach((row)=>map.set(String(row.client_id),String(row.client_name||row.client_id)));
    return [...map.entries()].sort((a,b)=>a[1].localeCompare(b[1]));
  },[operationalSubmissions]);
  useEffect(()=>{
    let cancelled=false;
    if(client==='ALL'){setScopedPortfolio(null);return()=>{cancelled=true;};}
    void listOperatingDashboard(client,period).then((result)=>{
      if(!cancelled) setScopedPortfolio(result.portfolioSummary||null);
    }).catch(()=>{ if(!cancelled) setScopedPortfolio(null); });
    return()=>{cancelled=true;};
  },[client,period]);

  const statuses=useMemo(()=>[...new Set(operationalSubmissions.map((row)=>String(row.state||'')).filter(Boolean))].sort(),[operationalSubmissions]);
  const tiers=useMemo(()=>[...new Set(operationalSubmissions.map((row)=>String(row.service_tier||'')).filter(Boolean))].sort(),[operationalSubmissions]);
  const visible=useMemo(()=>operationalSubmissions.filter((row)=>{
    const haystack=[row.client_name,row.project_name,row.period,row.payment_period,row.state,row.business.label,row.nextAction.label,row.id].join(' ').toLowerCase();
    const workflowFilter=simplifiedInternal
      ? (stage==='ALL'||row.business.stage===stage)
      : (status==='ALL'||row.state===status);
    return (period==='ALL'||row.period===period||row.payment_period===period)
      &&(client==='ALL'||row.client_id===client)&&workflowFilter
      &&(tier==='ALL'||row.service_tier===tier)&&(!query.trim()||haystack.includes(query.trim().toLowerCase()));
  }),[operationalSubmissions,period,client,status,stage,tier,query,simplifiedInternal]);
  const visibleIds=useMemo(()=>new Set(visible.map((row)=>row.id)),[visible]);
  const visibleInstructions=useMemo(()=>instructions.filter((row)=>visibleIds.has(row.submission_id)),[instructions,visibleIds]);

  const totalNet=visible.reduce((sum,row)=>sum+Number(row.total_net||0),0);
  const activeRuns=visible.filter((row)=>!row.business.isTerminal).length;
  const blockers=visible.reduce((sum,row)=>sum+Number(row.blocking_count||0),0);
  const openExceptions=visible.reduce((sum,row)=>sum+Number(row.open_exception_count||0),0);
  const affectedExceptionRuns=visible.filter((row)=>Number(row.open_exception_count||0)>0).length;
  const awaitingApproval=visible.filter((row)=>row.nextAction.actionable&&row.nextAction.category==='APPROVAL').length;
  const matched=visible.filter((row)=>row.reconciliation_status==='MATCHED').length;
  const reconciliationPending=visible.filter((row)=>row.business.stage==='CLOSE'&&row.reconciliation_status!=='MATCHED').length;
  const paymentDueInstructions=visibleInstructions.filter((row)=>['APPROVED_FOR_PAYMENT','DISBURSEMENT_PROCESSING'].includes(String(row.status)));
  const paymentDue=paymentDueInstructions.reduce((sum,row)=>sum+Number(row.expected_total||0),0);
  const paymentDueRecipients=paymentDueInstructions.reduce((sum,row)=>sum+Number(row.recipient_count||0),0);
  const proofCount=visibleInstructions.reduce((sum,row)=>sum+Number(row.proof_count||0),0);

  const actions=useMemo(()=>{
    return visible
      .filter((row)=>row.nextAction.actionable)
      .map((row)=>({
        id:`action-${row.id}-${row.nextAction.code}`,
        tone:row.nextAction.tone as Tone,
        title:row.nextAction.label,
        detail:`${row.business.label} · ${row.nextAction.description}`,
        client:row.client_name||row.client_id,
        amount:Number(row.total_net||0),
        action:row.nextAction.label,
        view:row.nextAction.view as AppView,
        priority:Number(row.nextAction.priority||5),
        category:String(row.nextAction.category||'WORK'),
        submissionId:String(row.id),
      }))
      .sort((a,b)=>a.priority-b.priority||({danger:0,warning:1,info:2,success:3}[a.tone]-{danger:0,warning:1,info:2,success:3}[b.tone]));
  },[visible]);

  const deadlines=useMemo(()=>visible.map((row)=>{
    const raw=row.payment_date||row.due_date||row.cutoff_date||row.payment_due_date;
    return {...row,deadline:raw,days:raw?daysFromNow(raw):null};
  }).filter((row)=>row.deadline&&row.days!==null&&row.days>=0&&row.days<=30)
    .sort((a,b)=>(a.days??0)-(b.days??0)).slice(0,6),[visible]);
  const pipeline=PIPELINE.map((stage)=>({...stage,rows:visible.filter((row)=>row.business.stage===stage.stage)}));
  const pipelineTotal=Math.max(1,visible.length);
  const pageCount=Math.max(1,Math.ceil(visible.length/10));
  const pageRows=visible.slice((page-1)*10,page*10);
  useEffect(()=>setPage(1),[period,client,status,stage,tier,query]);
  const reset=()=>{setClient('ALL');setStatus('ALL');setStage('ALL');setTier('ALL');setQuery('');};
  const openContext=(view:AppView,submissionId?:string,businessStage?:string)=>{
    const url=new URL(window.location.href);
    if(submissionId) url.searchParams.set('submissionId',submissionId); else url.searchParams.delete('submissionId');
    if(businessStage) url.searchParams.set('dashboardStage',businessStage); else url.searchParams.delete('dashboardStage');
    if(period&&period!=='ALL') url.searchParams.set('payrollPeriod',period); else url.searchParams.delete('payrollPeriod');
    window.history.replaceState({},'',url);
    onNavigate(view);
  };


  return <section className={`control-tower${simplifiedInternal?' control-tower-simple':''}`}>
    <div className="control-tower-heading"><div><span>{simplifiedInternal?'MY WORKSPACE':'PAYROLL CONTROL TOWER'}</span><h1>{workspaceTitle}</h1><p>{workspaceDescription}</p></div><button type="button" className="btn control-refresh" onClick={()=>{invalidateOperatingCache();void load();}}><IconRefresh aria-hidden="true" /> Refresh</button></div>
    <div className="control-bar card">
      <label><span>Klien</span><select value={client} onChange={(event)=>setClient(event.target.value)}><option value="ALL">Semua klien</option>{clients.map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label>
      {simplifiedInternal
        ? <label><span>Stage</span><select value={stage} onChange={(event)=>setStage(event.target.value)}><option value="ALL">Semua stage</option>{PIPELINE.map((item)=><option key={item.stage} value={item.stage}>{item.label}</option>)}</select></label>
        : <label><span>Status</span><select value={status} onChange={(event)=>setStatus(event.target.value)}><option value="ALL">Semua status</option>{statuses.map((item)=><option key={item}>{item}</option>)}</select></label>}
      {!simplifiedInternal ? <label><span>Service tier</span><select value={tier} onChange={(event)=>setTier(event.target.value)}><option value="ALL">Semua tier</option>{tiers.map((item)=><option key={item}>{statusLabel(item)}</option>)}</select></label> : null}
      <label className="control-search"><span>Pencarian</span><input value={query} onChange={(event)=>setQuery(event.target.value)} placeholder="Klien, project, payroll…" /></label>
      <button type="button" onClick={reset}>Reset</button>
    </div>
    {error?<div className="app-notice-bubble app-notice-error"><strong>Dashboard gagal dimuat</strong><span>{error}</span></div>:null}
    {data.dashboardMeta?.truncated?<div className="app-notice-bubble app-notice-error" role="alert"><strong>Dashboard dibatasi</strong><span>Menampilkan {Number(data.dashboardMeta.submissionsReturned||0).toLocaleString('id-ID')} dari {Number(data.dashboardMeta.submissionsTotal||0).toLocaleString('id-ID')} Pay Run. Gunakan periode yang lebih spesifik agar seluruh KPI akurat.</span></div>:null}
    {loading?<div className="card control-loading">Menyiapkan payroll control tower…</div>:<>
      {!simplifiedInternal ? <div className="portfolio-snapshot" aria-label="Ringkasan kesiapan master data">
        <span>Data readiness</span><b>{Number(portfolio.employees||0).toLocaleString('id-ID')} karyawan</b><i aria-hidden="true" />
        <b>{Number(portfolio.clients||0).toLocaleString('id-ID')} klien</b><i aria-hidden="true" />
        <b>{Number(portfolio.projects||0).toLocaleString('id-ID')} project</b><i aria-hidden="true" />
        <b>{Number(portfolio.bankCoveragePercent||0)}% rekening utama</b>
      </div> : null}
      <div className="control-kpis">
        {simplifiedInternal ? <>
          <Kpi label="My work" value={String(actions.length)} note="Tindakan yang membutuhkan Anda" tone="blue" icon={<IconLayers />} onClick={()=>actions[0]?openContext(actions[0].view,actions[0].submissionId):openContext('operations')} />
          <Kpi label="Need attention" value={String(actions.filter((item)=>item.tone==='danger').length)} note={`${blockers} blocker aktif`} tone="red" icon={<IconAlertTriangle />} onClick={()=>{const item=actions.find((row)=>row.tone==='danger');item?openContext(item.view,item.submissionId):openContext('exceptions');}} />
          <Kpi label="For my approval" value={String(awaitingApproval)} note="Approval sesuai role Anda" tone="amber" icon={<IconClock />} onClick={()=>{const item=actions.find((row)=>row.category==='APPROVAL');item?openContext(item.view,item.submissionId):openContext('operations');}} />
          <Kpi label="Active payroll" value={String(activeRuns)} note={`${visible.length} payroll pada filter`} tone="navy" icon={<IconWallet />} onClick={()=>openContext('operations')} />
        </> : <>
          <Kpi label="Active pay runs" value={String(activeRuns)} note={`${visible.length} pay run terfilter`} tone="blue" icon={<IconLayers />} onClick={()=>openContext('operations')} />
          <Kpi label="Need attention" value={String(actions.filter((item)=>item.tone==='danger').length)} note={`${blockers} blocker aktif`} tone="red" icon={<IconAlertTriangle />} onClick={()=>{const item=actions.find((row)=>row.tone==='danger');item?openContext(item.view,item.submissionId):openContext('operations');}} />
          <Kpi label="For my approval" value={String(awaitingApproval)} note="Approval yang membutuhkan role Anda" tone="amber" icon={<IconClock />} onClick={()=>{const item=actions.find((row)=>row.category==='APPROVAL');item?openContext(item.view,item.submissionId):openContext('operations');}} />
          <Kpi label="Payment due" value={formatIDRShort(paymentDue)} note={`${paymentDueRecipients.toLocaleString('id-ID')} penerima siap / sedang dibayar`} tone="navy" icon={<IconWallet />} featured onClick={()=>openContext('payments')} />
          <Kpi label="Paid & matched" value={String(matched)} note={`${reconciliationPending} menunggu reconciliation`} tone="green" icon={<IconCheckCircle />} onClick={()=>openContext('reports')} />
          <Kpi label="Open exceptions" value={String(openExceptions)} note="Belum resolved / accepted" tone="violet" icon={<IconShieldCheck />} onClick={()=>openContext('operations')} />
        </>}
      </div>
      <div className={simplifiedInternal?'':'control-priority-grid'}>
        <section className="card action-center"><PanelTitle eyebrow="PRIORITY QUEUE" title={simplifiedInternal?'My Work':'Action Center'} meta={`${actions.length} tindakan`} />
          <div className="action-list">{actions.length?actions.slice(0,simplifiedInternal?10:8).map((item)=><button type="button" key={item.id} onClick={()=>openContext(item.view,item.submissionId)}><i className={`action-tone ${item.tone}`} /><span><strong>{item.client}</strong><small>{item.title} · {item.detail}</small></span><b>{item.amount?formatIDRShort(item.amount):'-'}</b><em>{item.action} →</em></button>):<Empty text="Tidak ada tindakan yang membutuhkan Anda pada filter ini." />}</div>
        </section>
        {!simplifiedInternal ? <section className="card deadline-panel"><PanelTitle eyebrow="UPCOMING 30 DAYS" title="Deadline & SLA" meta={`${deadlines.length} agenda`} />
          <div className="deadline-list">{deadlines.length?deadlines.map((item)=><button type="button" key={item.id} onClick={()=>openContext('operations',String(item.id))}><time>{dateLabel(item.deadline)}</time><span><strong>{item.client_name||item.client_id}</strong><small>{item.business.label} · {statusLabel(item.state)}</small></span><b className={item.days!==null&&item.days<0?'overdue':''}>{item.days===null?'-':item.days<0?`${Math.abs(item.days)}h terlambat`:item.days===0?'Hari ini':`${item.days} hari`}</b></button>):<Empty text="Belum ada deadline operasional." />}</div>
        </section> : null}
      </div>
      <section className="card pipeline-panel">
        <PanelTitle eyebrow="END-TO-END WORKFLOW" title="Payroll Pipeline" meta={`${visible.length} pay run`} />
        <div className="pipeline-grid">{pipeline.map((stage,index)=>{
          const share=Math.round((stage.rows.length/pipelineTotal)*100);
          const meterWidth=stage.rows.length?Math.max(8,share):0;
          const stageValue=stage.rows.reduce((sum,row)=>sum+Number(row.total_net||0),0);
          return <button type="button" key={stage.label} onClick={()=>openContext(stage.view,undefined,stage.stage)} aria-label={`${stage.label}: ${stage.rows.length} pay run, buka ${stage.view}`}>
            <span>{index+1}</span>
            <strong>{stage.rows.length}</strong>
            <small>{stage.label}</small>
            <div className="pipeline-stage-hint"><b>{stage.description}</b><span>{share}%</span></div>
            <div className="pipeline-meter" aria-hidden="true"><i style={{width:`${meterWidth}%`}} /></div>
            <em>{formatIDRShort(stageValue)} · Klik untuk buka</em>
          </button>;
        })}</div>
      </section>
      <section className="card portfolio-panel"><PanelTitle eyebrow={simplifiedInternal?'ALL PAYROLL':'PORTFOLIO MONITORING'} title={simplifiedInternal?'Payroll Overview':'Pay Run Portfolio'} meta={`${visible.length} record`} />
        <div className="portfolio-table-wrap"><table className="portfolio-table"><thead>{simplifiedInternal
          ? <tr><th>Klien / Project</th><th>Periode</th><th>Stage</th><th>Net / THP</th><th>Next action</th></tr>
          : <tr><th>Klien / Project</th><th>Periode</th><th>Tier</th><th>Penerima</th><th>Net / THP</th><th>Blocker</th><th>Current stage</th><th>Next action</th></tr>}</thead><tbody>{pageRows.map((row)=>simplifiedInternal
            ? <tr key={row.id}><td><strong>{row.client_name||row.client_id}</strong><small>{row.project_name||row.id}</small></td><td>{row.period}<small>Bayar {row.payment_period||row.period}</small></td><td><span className="stage-pill">{row.business.label}</span><small>{statusLabel(row.business.status)}</small></td><td><strong>{formatIDR(Number(row.total_net||0))}</strong>{Number(row.blocking_count||0)?<small>{row.blocking_count} blocker</small>:null}</td><td><button type="button" onClick={()=>openContext(row.nextAction.view as AppView,String(row.id))}>{row.nextAction.label} →</button><small>{row.nextAction.actionable?'Action required':'Monitor only'}</small></td></tr>
            : <tr key={row.id}><td><strong>{row.client_name||row.client_id}</strong><small>{row.project_name||row.id}</small></td><td>{row.period}<small>Bayar {row.payment_period||row.period}</small></td><td>{statusLabel(row.service_tier).replace('TIER 1 ','T1 · ').replace('TIER 2 ','T2 · ').replace('TIER 3 ','T3 · ')}</td><td>{Number(row.employee_count||0).toLocaleString('id-ID')}</td><td><strong>{formatIDR(Number(row.total_net||0))}</strong></td><td><span className={Number(row.blocking_count||0)?'table-blocker':'table-clear'}>{Number(row.blocking_count||0)}</span></td><td><span className="stage-pill">{row.business.label}</span><small>{statusLabel(row.state)}</small></td><td><button type="button" onClick={()=>openContext(row.nextAction.view as AppView,String(row.id))}>{row.nextAction.label} →</button><small>{row.nextAction.actionable?'Action required':'No action required'}</small></td></tr>)}</tbody></table>{!pageRows.length?<Empty text="Tidak ada payroll sesuai filter." />:null}</div>
        <div className="control-pagination"><span>Halaman {Math.min(page,pageCount)} dari {pageCount}</span><div><button className="btn" disabled={page<=1} onClick={()=>setPage((value)=>value-1)}>←</button><button className="btn" disabled={page>=pageCount} onClick={()=>setPage((value)=>value+1)}>→</button></div></div>
      </section>
      {!simplifiedInternal ? <div className="control-bottom-grid"><section className="card payment-control"><PanelTitle eyebrow="PAYMENT INTEGRITY" title="Payment Control" meta={`${visibleInstructions.length} PI`} /><div className="payment-control-grid"><div><span>PI value</span><strong>{formatIDRShort(visibleInstructions.reduce((sum,row)=>sum+Number(row.expected_total||0),0))}</strong></div><div><span>Matched</span><strong>{matched}</strong></div><div><span>Proof tercatat</span><strong>{proofCount}</strong></div><div><span>Legacy hash</span><strong>{visibleInstructions.filter((row)=>!row.content_hash).length}</strong></div></div><button type="button" className="btn" onClick={()=>openContext('payments')}>Buka payment control</button></section>
        <section className="card trend-panel"><PanelTitle eyebrow="OPERATIONAL HEALTH" title="Performa periode" meta="Portfolio" /><div className="health-list"><div><span>No critical blocker</span><strong>{visible.length?Math.round((visible.filter((row)=>!Number(row.blocking_count||0)).length/visible.length)*100):0}%</strong></div><div><span>Reconciliation match</span><strong>{visible.filter((row)=>row.business.stage==='CLOSE').length?Math.round((matched/visible.filter((row)=>row.business.stage==='CLOSE').length)*100):0}%</strong></div><div><span>Pay runs with exception</span><strong>{visible.length?((affectedExceptionRuns/visible.length)*100).toFixed(1):'0.0'}%</strong></div></div><div className="role-focus"><span>{actor.role.replaceAll('_',' ')}</span><p>{roleFocus(actor.role)}</p></div></section></div> : null}
    </>}
  </section>;
}

function Kpi({label,value,note,tone,icon,featured=false,onClick}:{label:string;value:string;note:string;tone:string;icon:React.ReactNode;featured?:boolean;onClick:()=>void}) { return <button type="button" className={`control-kpi ${tone}${featured?' featured':''}`} onClick={onClick}><span className="control-kpi-icon" aria-hidden="true">{icon}</span><span className="control-kpi-label">{label}</span><strong>{value}</strong><small>{note}</small><i aria-hidden="true">↗</i></button>; }
function PanelTitle({eyebrow,title,meta}:{eyebrow:string;title:string;meta:string}) { return <div className="control-panel-title"><div><span>{eyebrow}</span><h2>{title}</h2></div><small>{meta}</small></div>; }
function Empty({text}:{text:string}) { return <div className="control-empty">{text}</div>; }
function roleFocus(role:string) { return role==='PAYROLL_PROCESSOR'?'Prioritas Anda: Prepare dan Review payroll, lalu siapkan proses Pay setelah approval.':role==='PAYROLL_CONTROLLER'?'Prioritas Anda: Approve payroll/payment dan memastikan Close melalui rekonsiliasi serta billing.':role==='CLIENT_USER'?'Prioritas Anda: pantau payroll, tindak lanjuti Action Required, dan lihat hasil proses.':'Pantau Prepare → Review → Approve → Pay → Close untuk seluruh klien.'; }

'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import OperatingWorkspace, { type WorkspaceFilterState } from '@/components/OperatingWorkspace';
import { listOperatingResource } from '@/lib/operating-model-api';

type Stage = 'PAYROLL' | 'PAYMENT' | 'CLOSE';

type Props = {
  role:string;
  period:string;
  gatewayCanView:boolean;
  initialStage?:Stage;
};

const stageMeta:Record<Stage,{step:string;title:string;description:string;url:string}> = {
  PAYROLL: {
    step:'1',
    title:'Data & Payroll',
    description:'Upload, readiness, issue, dan proses payroll.',
    url:'payroll',
  },
  PAYMENT: {
    step:'2',
    title:'Approval & Payment',
    description:'PI, approval Controller, liquidity, dan Process Payment.',
    url:'payment',
  },
  CLOSE: {
    step:'3',
    title:'Reconcile & Close',
    description:'Proof, reconciliation, billing, AR, dan close period.',
    url:'close',
  },
};

function stageFromUrl(value:string|null):Stage|null {
  if (value === 'payroll') return 'PAYROLL';
  if (value === 'payment') return 'PAYMENT';
  if (value === 'close') return 'CLOSE';
  return null;
}

function urlFilters():WorkspaceFilterState {
  if (typeof window === 'undefined') return { clientId:'ALL', projectId:'ALL', query:'' };
  const params=new URLSearchParams(window.location.search);
  return {
    clientId:params.get('clientId') || 'ALL',
    projectId:params.get('projectId') || 'ALL',
    query:params.get('q') || '',
  };
}

export default function UnifiedPayrollWorkspace({
  role,
  period,
  gatewayCanView,
  initialStage='PAYROLL',
}:Props) {
  const initialUrlStage=typeof window==='undefined'?null:stageFromUrl(new URLSearchParams(window.location.search).get('stage'));
  const [stage,setStage]=useState<Stage>(initialUrlStage || initialStage);
  const [filters,setFilters]=useState<WorkspaceFilterState>(urlFilters);
  const [submissions,setSubmissions]=useState<any[]>([]);

  const canUpload=useMemo(()=>['SUPER_ADMIN','PAYROLL_PROCESSOR','CLIENT_USER'].includes(role),[role]);
  const isController=role==='PAYROLL_CONTROLLER';

  useEffect(()=>{
    const fromUrl=stageFromUrl(new URLSearchParams(window.location.search).get('stage'));
    setStage(fromUrl || initialStage);
  },[initialStage]);

  useEffect(()=>{
    let cancelled=false;
    void listOperatingResource<{submissions?:any[]}>('submissions')
      .then((result)=>{if(!cancelled)setSubmissions(result.submissions || []);})
      .catch(()=>{if(!cancelled)setSubmissions([]);});
    return ()=>{cancelled=true;};
  },[]);

  useEffect(()=>{
    const onPop=()=>{
      const params=new URLSearchParams(window.location.search);
      setStage(stageFromUrl(params.get('stage')) || initialStage);
      setFilters({
        clientId:params.get('clientId') || 'ALL',
        projectId:params.get('projectId') || 'ALL',
        query:params.get('q') || '',
      });
    };
    window.addEventListener('popstate',onPop);
    return ()=>window.removeEventListener('popstate',onPop);
  },[initialStage]);

  const changeStage=useCallback((next:Stage)=>{
    setStage(next);
    const url=new URL(window.location.href);
    url.searchParams.set('view','operations');
    url.searchParams.set('period',period);
    url.searchParams.set('stage',stageMeta[next].url);
    window.history.pushState({view:'operations',period,stage:stageMeta[next].url},'',url);
  },[period]);

  const patchFilters=useCallback((patch:Partial<WorkspaceFilterState>)=>{
    setFilters((current)=>{
      const next={...current,...patch};
      if (patch.clientId && patch.clientId !== current.clientId) next.projectId='ALL';
      const url=new URL(window.location.href);
      if(next.clientId==='ALL') url.searchParams.delete('clientId'); else url.searchParams.set('clientId',next.clientId);
      if(next.projectId==='ALL') url.searchParams.delete('projectId'); else url.searchParams.set('projectId',next.projectId);
      if(next.query.trim()) url.searchParams.set('q',next.query.trim()); else url.searchParams.delete('q');
      window.history.replaceState(window.history.state,'',url);
      return next;
    });
  },[]);

  const scopedSubmissions=useMemo(
    ()=>submissions.filter((row)=>period==='ALL' || row.period===period || row.payment_period===period),
    [submissions,period],
  );
  const clients=useMemo(()=>{
    const map=new Map<string,string>();
    scopedSubmissions.forEach((row)=>map.set(String(row.client_id),String(row.client_name || row.client_id)));
    return [...map.entries()].sort((a,b)=>a[1].localeCompare(b[1]));
  },[scopedSubmissions]);
  const projects=useMemo(()=>{
    const map=new Map<string,string>();
    scopedSubmissions
      .filter((row)=>filters.clientId==='ALL' || String(row.client_id)===filters.clientId)
      .forEach((row)=>{if(row.project_id)map.set(String(row.project_id),String(row.project_name || row.project_id));});
    return [...map.entries()].sort((a,b)=>a[1].localeCompare(b[1]));
  },[scopedSubmissions,filters.clientId]);

  useEffect(()=>{
    if(filters.clientId!=='ALL' && !clients.some(([id])=>id===filters.clientId)) patchFilters({clientId:'ALL',projectId:'ALL'});
  },[clients,filters.clientId,patchFilters]);
  useEffect(()=>{
    if(filters.projectId!=='ALL' && !projects.some(([id])=>id===filters.projectId)) patchFilters({projectId:'ALL'});
  },[projects,filters.projectId,patchFilters]);

  return (
    <section className="unified-payroll-workspace">
      <header className="unified-payroll-head">
        <div>
          <span className="page-eyebrow">END-TO-END PAYROLL</span>
          <h1>Payroll Workspace</h1>
          <p>Satu workspace, tiga tahap bisnis. Detail teknis tetap tercatat di backend tanpa memperpanjang perjalanan pengguna.</p>
        </div>
        {canUpload ? (
          <Link className="btn btn-primary" href={`/data-intake?period=${encodeURIComponent(period)}`}>
            Upload Payroll Data
          </Link>
        ) : null}
      </header>

      <nav className="payroll-stage-nav" aria-label="Tahap payroll">
        {(Object.keys(stageMeta) as Stage[]).map((key)=>{
          const meta=stageMeta[key];
          return (
            <button
              key={key}
              type="button"
              className={stage===key?'active':''}
              aria-current={stage===key?'step':undefined}
              onClick={()=>changeStage(key)}
            >
              <b>{meta.step}</b>
              <span><strong>{meta.title}</strong><small>{meta.description}</small></span>
            </button>
          );
        })}
      </nav>

      <div className="payroll-shared-filter card" aria-label="Filter Payroll Workspace">
        <label><span>Periode</span><strong>{period}</strong></label>
        <label><span>Klien</span><select value={filters.clientId} onChange={(event)=>patchFilters({clientId:event.target.value})}><option value="ALL">Semua klien</option>{clients.map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label>
        <label><span>Project</span><select value={filters.projectId} disabled={!projects.length} onChange={(event)=>patchFilters({projectId:event.target.value})}><option value="ALL">Semua project</option>{projects.map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label>
        <label className="payroll-shared-search"><span>Pencarian</span><input value={filters.query} onChange={(event)=>patchFilters({query:event.target.value})} placeholder="Klien, project, pay run, PI…" /></label>
      </div>

      {stage==='PAYROLL' ? (
        <div className="unified-payroll-stage">
          {canUpload ? (
            <div className="workflow-shortcut card">
              <div>
                <span>1 · DATA & PAYROLL</span>
                <strong>Client atau Payroll Processor upload, ProQPay memvalidasi dan menyiapkan payroll</strong>
                <small>Readiness dan exception tetap tersedia sebagai detail kerja, bukan langkah navigasi tambahan.</small>
              </div>
              <Link className="btn" href={`/data-intake?period=${encodeURIComponent(period)}`}>Upload / Review Data</Link>
            </div>
          ) : (
            <div className="workflow-shortcut card">
              <div>
                <span>1 · DATA & PAYROLL</span>
                <strong>Data disiapkan Client / Payroll Processor</strong>
                <small>Controller memonitor hasil payroll tanpa menjadi uploader normal.</small>
              </div>
            </div>
          )}
          <OperatingWorkspace mode="payruns" period={period} filters={filters} embedded />
        </div>
      ) : null}

      {stage==='PAYMENT' ? (
        <div className="unified-payroll-stage">
          <div className="workflow-shortcut card">
            <div>
              <span>2 · APPROVAL & PAYMENT</span>
              <strong>{isController?'Review PI, approve, lalu Process Payment':'Prepare PI dan submit ke Payroll Controller'}</strong>
              <small>PI dan gateway sekarang berada dalam satu payment surface; final execution hanya Payroll Controller.</small>
            </div>
          </div>
          <OperatingWorkspace mode="payments" period={period} filters={filters} embedded gatewayCanView={gatewayCanView} />
        </div>
      ) : null}

      {stage==='CLOSE' ? (
        <div className="unified-payroll-stage">
          <div className="workflow-shortcut card">
            <div>
              <span>3 · RECONCILE & CLOSE</span>
              <strong>Reconcile payment, lanjutkan billing/AR, lalu close payroll period</strong>
              <small>Reconciliation tidak lagi bercampur dengan approval/payment execution.</small>
            </div>
          </div>
          <div id="reconcile-work"><OperatingWorkspace mode="reconcile" period={period} filters={filters} embedded /></div>
          <div id="billing-close" className="payroll-close-section"><OperatingWorkspace mode="billing" period={period} filters={filters} embedded /></div>
        </div>
      ) : null}
    </section>
  );
}

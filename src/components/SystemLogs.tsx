'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  clearSystemLogs,
  loadSystemLogs,
  onSystemLogChange,
  type SystemLogEntry,
  type SystemLogLevel,
} from '@/lib/system-log';

type CanonicalEvent={
  id:string;timestamp:string;category:string;level:string;source:string;event:string;
  actor:string;role?:string;entity?:string;entity_id?:string;detail?:string;status?:string;ip?:string;
};
type Summary={
  total:number;errors:number;warnings:number;events24h:number;employeeErrors24h:number;
  connectedApps:number;appsWithError:number;lastActivityAt?:string|null;
};
type HealthCheck={key:string;label:string;status:'ok'|'warning'|'error';message:string;action?:string};
type Health={status:string;ready:boolean;checks:HealthCheck[]};

const CATEGORY_LABELS:Record<string,string>={
  BUSINESS:'Business',SECURITY:'Security',EMPLOYEE_SERVICES:'Employee Services',
  PAYMENTS:'Payments',BILLING_AR:'Billing & AR',INTEGRATIONS:'Integrations',LOCAL:'Local diagnostics',
};
const LEVELS=['ALL','INFO','SUCCESS','WARN','ERROR'];
const CATEGORIES=['ALL','BUSINESS','SECURITY','EMPLOYEE_SERVICES','PAYMENTS','BILLING_AR','INTEGRATIONS','LOCAL'];

function when(value:string|number){
  const date=typeof value==='number'?new Date(value):new Date(String(value));
  if(Number.isNaN(date.getTime()))return String(value||'—');
  return new Intl.DateTimeFormat('id-ID',{timeZone:'Asia/Jakarta',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(date)+' WIB';
}
function localToCanonical(item:SystemLogEntry):CanonicalEvent{
  return {
    id:'local-'+item.id,
    timestamp:new Date(item.timestamp).toISOString(),
    category:'LOCAL',
    level:item.level,
    source:item.source,
    event:item.event,
    actor:'BROWSER',
    role:'LOCAL',
    entity:'browser_session',
    entity_id:'',
    detail:item.message+(item.meta?' · '+JSON.stringify(item.meta):''),
    status:'',
    ip:'',
  };
}
function humanize(value:string){
  return String(value||'').replaceAll('_',' ').toLowerCase().replace(/(^|\s)\S/g,(c)=>c.toUpperCase());
}

export default function SystemLogs(){
  const [events,setEvents]=useState<CanonicalEvent[]>([]);
  const [localLogs,setLocalLogs]=useState<SystemLogEntry[]>([]);
  const [summary,setSummary]=useState<Summary>({total:0,errors:0,warnings:0,events24h:0,employeeErrors24h:0,connectedApps:0,appsWithError:0});
  const [health,setHealth]=useState<Health|null>(null);
  const [loading,setLoading]=useState(true);
  const [message,setMessage]=useState('');
  const [q,setQ]=useState('');
  const [category,setCategory]=useState('ALL');
  const [level,setLevel]=useState('ALL');
  const [from,setFrom]=useState('');
  const [to,setTo]=useState('');
  const [offset,setOffset]=useState(0);
  const [limit,setLimit]=useState(50);
  const [page,setPage]=useState({total:0,hasMore:false,nextOffset:0});
  const [selected,setSelected]=useState<CanonicalEvent|null>(null);

  const load=useCallback(async()=>{
    setLoading(true);setMessage('');
    try{
      const params=new URLSearchParams({offset:String(offset),limit:String(limit)});
      if(q.trim())params.set('q',q.trim());
      if(category!=='ALL'&&category!=='LOCAL')params.set('category',category);
      if(level!=='ALL')params.set('level',level);
      if(from)params.set('from',from);
      if(to)params.set('to',to);
      const [auditResponse,healthResponse]=await Promise.all([
        fetch('/api/audit-console?'+params.toString(),{cache:'no-store'}),
        fetch('/api/health',{cache:'no-store'}),
      ]);
      const audit=await auditResponse.json().catch(()=>({}));
      const healthData=await healthResponse.json().catch(()=>({}));
      if(!auditResponse.ok)throw new Error(audit.error||`HTTP ${auditResponse.status}`);
      setEvents(Array.isArray(audit.events)?audit.events:[]);
      setSummary(audit.summary||{});
      setPage({
        total:Number(audit.page?.total||0),
        hasMore:Boolean(audit.page?.hasMore),
        nextOffset:Number(audit.page?.nextOffset||0),
      });
      setHealth(healthResponse.ok?healthData:null);
    }catch(error){setMessage(error instanceof Error?error.message:'Audit Console gagal dimuat');}
    finally{setLoading(false);}
  },[q,category,level,from,to,offset,limit]);

  useEffect(()=>{void load();},[load]);
  useEffect(()=>{
    const refresh=()=>setLocalLogs(loadSystemLogs());
    refresh();
    return onSystemLogChange(refresh);
  },[]);
  useEffect(()=>{
    if(!selected)return;
    const onKey=(event:KeyboardEvent)=>{if(event.key==='Escape')setSelected(null);};
    document.addEventListener('keydown',onKey);
    return()=>document.removeEventListener('keydown',onKey);
  },[selected]);

  const visible=useMemo(()=>{
    const locals=localLogs.map(localToCanonical);
    if(category==='LOCAL'){
      const query=q.trim().toLowerCase();
      return locals.filter((item)=>{
        if(level!=='ALL'&&item.level!==level)return false;
        if(!query)return true;
        return [item.source,item.event,item.detail,item.actor].some((value)=>String(value||'').toLowerCase().includes(query));
      }).sort((a,b)=>String(b.timestamp).localeCompare(String(a.timestamp)));
    }
    if(offset===0&&category==='ALL'){
      return [...events,...locals].sort((a,b)=>String(b.timestamp).localeCompare(String(a.timestamp))).slice(0,Math.max(limit,events.length));
    }
    return events;
  },[events,localLogs,category,level,q,offset,limit]);

  const unhealthy=(health?.checks||[]).filter((item)=>item.status!=='ok');
  const resetFilters=()=>{setQ('');setCategory('ALL');setLevel('ALL');setFrom('');setTo('');setOffset(0);};

  return <section className="audit-console">
    <section className="audit-console-hero">
      <div>
        <span className="audit-console-eyebrow">SYSTEM · SECURITY · BUSINESS OBSERVABILITY</span>
        <h1>Audit Console</h1>
        <p>Satu console untuk seluruh jejak bisnis, Employee Services, security/login, payment, billing, integrations, diagnostics lokal, dan status layanan ProQPay.</p>
        <div className="audit-console-meta">
          <span><strong>{summary.events24h||0}</strong> event 24 jam</span>
          <span><strong>{summary.errors||0}</strong> error canonical</span>
          <span><strong>{summary.connectedApps||0}</strong> connected app</span>
          <span className={health?.ready?'ok':'warn'}>{health?.ready?'System ready':'Perlu perhatian'}</span>
        </div>
      </div>
      <button type="button" className="btn" disabled={loading} onClick={()=>void load()}>{loading?'Memuat…':'Refresh console'}</button>
    </section>

    <div className="audit-status-grid">
      <article className="audit-status-card"><span>Canonical events</span><strong>{summary.total||0}</strong><small>Semua event D1 terindeks</small></article>
      <article className="audit-status-card tone-error"><span>Error</span><strong>{summary.errors||0}</strong><small>{summary.employeeErrors24h||0} Employee Services / 24h</small></article>
      <article className="audit-status-card tone-warn"><span>Warning</span><strong>{summary.warnings||0}</strong><small>Butuh observasi operasional</small></article>
      <article className="audit-status-card"><span>Integrations</span><strong>{summary.connectedApps||0}</strong><small>{summary.appsWithError||0} app terakhir error</small></article>
    </div>

    {health?<section className="card audit-health-strip">
      <div className="audit-health-title"><div><span>System status</span><strong>{health.ready?'Operational':'Attention required'}</strong></div><small>{unhealthy.length?unhealthy.length+' issue aktif':'Semua pemeriksaan utama normal'}</small></div>
      <div className="audit-health-checks">{health.checks.map((item)=><div key={item.key} className={'audit-health-item '+item.status}><i/><span><strong>{item.label}</strong><small>{item.message}</small></span></div>)}</div>
    </section>:null}

    <section className="card audit-filter-panel">
      <div className="audit-filter-head"><div><strong>Search & filters</strong><span>Filter satu stream lintas domain tanpa berpindah halaman.</span></div>{(q||category!=='ALL'||level!=='ALL'||from||to)?<button type="button" className="btn" onClick={resetFilters}>Reset filter</button>:null}</div>
      <div className="audit-filter-grid">
        <label className="audit-filter-search"><span>Pencarian</span><input value={q} onChange={(e)=>{setQ(e.target.value);setOffset(0)}} placeholder="Event, actor, entity, detail, source…"/></label>
        <label><span>Kategori</span><select value={category} onChange={(e)=>{setCategory(e.target.value);setOffset(0)}}>{CATEGORIES.map((item)=><option key={item} value={item}>{item==='ALL'?'Semua kategori':CATEGORY_LABELS[item]}</option>)}</select></label>
        <label><span>Level</span><select value={level} onChange={(e)=>{setLevel(e.target.value);setOffset(0)}}>{LEVELS.map((item)=><option key={item} value={item}>{item==='ALL'?'Semua level':item}</option>)}</select></label>
        <label><span>Dari</span><input type="date" value={from} onChange={(e)=>{setFrom(e.target.value);setOffset(0)}}/></label>
        <label><span>Sampai</span><input type="date" value={to} onChange={(e)=>{setTo(e.target.value);setOffset(0)}}/></label>
        <label><span>Baris</span><select value={limit} onChange={(e)=>{setLimit(Number(e.target.value));setOffset(0)}}><option value={25}>25</option><option value={50}>50</option><option value={100}>100</option></select></label>
      </div>
    </section>

    {message?<div className="app-notice-bubble app-notice-error" role="alert"><span>{message}</span><button type="button" className="btn" onClick={()=>void load()}>Coba lagi</button></div>:null}

    <section className="card audit-stream-card">
      <div className="audit-stream-head">
        <div><strong>Unified event stream</strong><span>{category==='LOCAL'?visible.length:page.total} event sesuai filter</span></div>
        <button type="button" className="btn" onClick={()=>{clearSystemLogs();setLocalLogs([])}} disabled={!localLogs.length}>Bersihkan diagnostics lokal</button>
      </div>
      <div className="audit-stream-table-wrap">
        <table className="data-table audit-stream-table">
          <thead><tr><th>Waktu</th><th>Level</th><th>Kategori / sumber</th><th>Event</th><th>Actor</th><th>Detail</th><th/></tr></thead>
          <tbody>{visible.map((item)=><tr key={item.id}>
            <td className="audit-time">{when(item.timestamp)}</td>
            <td><span className={'audit-level level-'+item.level.toLowerCase()}>{item.level}</span></td>
            <td><strong>{CATEGORY_LABELS[item.category]||humanize(item.category)}</strong><small>{item.source}</small></td>
            <td><strong>{humanize(item.event)}</strong><small>{item.event}</small></td>
            <td>{item.actor||'SYSTEM'}<small>{item.role||'—'}</small></td>
            <td className="audit-detail-cell">{item.detail||item.entity_id||'—'}</td>
            <td className="audit-action"><button type="button" className="btn" onClick={()=>setSelected(item)}>Detail</button></td>
          </tr>)}</tbody>
        </table>
        {!loading&&!message&&!visible.length?<div className="audit-empty">Belum ada event yang cocok dengan filter.</div>:null}
      </div>
      {category!=='LOCAL'?<div className="audit-pagination"><span>{page.total?`${offset+1}–${Math.min(offset+events.length,page.total)} dari ${page.total}`:'0 data'}</span><div><button className="btn" disabled={offset===0||loading} onClick={()=>setOffset(Math.max(0,offset-limit))}>Sebelumnya</button><button className="btn" disabled={!page.hasMore||loading} onClick={()=>setOffset(page.nextOffset)}>Berikutnya</button></div></div>:null}
    </section>

    {selected?<div className="es-drawer-backdrop" role="presentation" onMouseDown={(e)=>{if(e.currentTarget===e.target)setSelected(null)}}>
      <aside className="es-drawer audit-detail-drawer" role="dialog" aria-modal="true" aria-labelledby="audit-event-title">
        <div className="es-drawer-head"><div><span className="audit-console-eyebrow">EVENT DETAIL</span><h2 id="audit-event-title">{humanize(selected.event)}</h2><small>{selected.id}</small></div><button type="button" className="btn" onClick={()=>setSelected(null)}>Tutup</button></div>
        <div className="es-detail-grid">
          <div><span>Waktu</span>{when(selected.timestamp)}</div><div><span>Level</span>{selected.level}</div>
          <div><span>Kategori</span>{CATEGORY_LABELS[selected.category]||selected.category}</div><div><span>Sumber</span>{selected.source}</div>
          <div><span>Actor</span>{selected.actor||'SYSTEM'}</div><div><span>Role</span>{selected.role||'—'}</div>
          <div><span>Entity</span>{selected.entity||'—'}</div><div><span>Entity ID</span>{selected.entity_id||'—'}</div>
          <div><span>Status</span>{selected.status||'—'}</div><div><span>IP</span>{selected.ip||'—'}</div>
          <div className="audit-detail-full"><span>Detail</span>{selected.detail||'—'}</div>
        </div>
      </aside>
    </div>:null}
  </section>;
}

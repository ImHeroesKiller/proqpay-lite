"use client";

import { useCallback, useEffect, useState } from "react";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { EmployeeServiceState } from "@/components/employee-services/OperationalState";

type LoginRow={id:string;employee_id_input?:string;employee_id?:string;employee_name?:string;employee_code?:string;ip?:string;success:number;reason?:string;created_at:string};
type EventRow={id:string;timestamp:string;username?:string;role?:string;action:string;detail?:string;entity?:string;entity_id?:string};

const when=(value:string)=>String(value||"").replace("T"," ").slice(0,19);

const ACTION_LABELS: Record<string,string> = {
  EWA_SUBMITTED: "Advance diajukan",
  EWA_APPROVED: "Advance disetujui",
  EWA_REJECTED: "Advance ditolak",
  EWA_DISBURSED: "Advance dicairkan",
  EWA_REPAID_RECONCILED: "Advance lunas setelah rekonsiliasi",
  EMPLOYEE_PASSWORD_CHANGED: "Password portal diubah",
  EMPLOYEE_PORTAL_PASSWORDS_ISSUED: "Kredensial portal diterbitkan",
};
const actionLabel=(value:string)=>ACTION_LABELS[value]||value.replaceAll("_"," ").toLowerCase().replace(/^./,(c)=>c.toUpperCase());

export default function PortalAudit(){
  const [logins,setLogins]=useState<LoginRow[]>([]);
  const [events,setEvents]=useState<EventRow[]>([]);
  const [failed,setFailed]=useState(0);
  const [tab,setTab]=useState<"logins"|"events">("logins");
  const [q,setQ]=useState("");
  const qDebounced=useDebouncedValue(q,300);
  const [offset,setOffset]=useState(0);
  const [page,setPage]=useState({total:0,hasMore:false,nextOffset:0,limit:50});
  const [limit,setLimit]=useState(50);
  const [loading,setLoading]=useState(true);
  const [message,setMessage]=useState("");
  const [selected,setSelected]=useState<LoginRow|EventRow|null>(null);
  const [success,setSuccess]=useState("");
  const [group,setGroup]=useState("");
  const [from,setFrom]=useState("");
  const [to,setTo]=useState("");

  const load=useCallback(async()=>{
    setLoading(true);setMessage("");
    const params=new URLSearchParams({kind:tab,offset:String(offset),limit:String(limit)});
    if(qDebounced.trim())params.set("q",qDebounced.trim());
    if(tab==="logins" && success)params.set("success",success);
    if(tab==="events" && group)params.set("group",group);
    if(from)params.set("from",from);
    if(to)params.set("to",to);
    try{
      const response=await fetch(`/api/portal-audit?${params.toString()}`,{cache:"no-store"});
      const data=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(data.error||`HTTP ${response.status}`);
      setLogins(data.logins||[]);setEvents(data.events||[]);
      setFailed(Number(data.failedLogins||0));
      setPage({total:Number(data.page?.total||0),hasMore:Boolean(data.page?.hasMore),nextOffset:Number(data.page?.nextOffset||0),limit:Number(data.page?.limit||50)});
    }catch(error){setMessage(error instanceof Error?error.message:"Gagal memuat audit");}
    finally{setLoading(false);}
  },[tab,qDebounced,success,group,from,to,offset,limit]);

  useEffect(()=>{void load();},[load]);
  const rows=tab==="logins"?logins:events;

  return <section className="portal-workspace">
    <style>{`
      .pa-mobile{display:none}.pa-result{font-size:11px;font-weight:700}.pa-result.ok{color:var(--success,#16803c)}.pa-result.fail{color:var(--danger,#c5362f)}
      .pa-detail{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.pa-detail div{border:1px solid var(--border);border-radius:10px;padding:10px;font-size:12px}.pa-detail span{display:block;color:var(--text3);font-size:10px;margin-bottom:3px}
      .pa-table-wrap{overflow:auto;max-height:min(68vh,720px)}.pa-table{width:100%;border-collapse:separate;border-spacing:0;min-width:820px}.pa-table thead th{position:sticky;top:0;z-index:3;background:var(--card,#fff)}.pa-table .pa-action{position:sticky;right:0;background:var(--card,#fff);text-align:right;z-index:2}
      .pa-drawer-backdrop{position:fixed;inset:0;z-index:160;background:rgba(10,15,25,.38);display:flex;justify-content:flex-end}.pa-drawer{width:min(520px,100%);height:100%;overflow:auto;background:var(--card,#fff);border-left:1px solid var(--border);box-shadow:-18px 0 40px rgba(0,0,0,.14);padding:20px}.pa-drawer-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;margin-bottom:16px}
      @media(max-width:760px){.pa-desktop{display:none}.pa-mobile{display:grid;gap:10px}.pa-card{border:1px solid var(--border);border-radius:14px;padding:14px;background:var(--card,#fff)}.pa-detail{grid-template-columns:1fr}.pa-drawer{width:100%;border-left:0}}
    `}</style>
    <div className="page-heading">
      <div><span className="page-eyebrow">Employee Services</span><h1>Portal Activity & Audit</h1><p>Jejak akses ESS, advance salary, kredensial, dan perubahan password dengan pencarian serta pagination.</p></div>
      <div style={{display:"flex",gap:8,alignItems:"center"}}><span className="status-pill">{failed} login gagal</span><button type="button" className="btn" disabled={loading} onClick={()=>void load()}>{loading?"Memuat…":"Refresh"}</button></div>
    </div>
    <div className="portal-toolbar">
      <button type="button" className={`btn${tab==="logins"?" btn-primary":""}`} onClick={()=>{setTab("logins");setOffset(0);setSelected(null)}}>Login</button>
      <button type="button" className={`btn${tab==="events"?" btn-primary":""}`} onClick={()=>{setTab("events");setOffset(0);setSelected(null)}}>Advance & kredensial</button>
    </div>
    <div className="portal-toolbar">
      <input value={q} onChange={e=>{setQ(e.target.value);setOffset(0)}} placeholder={tab==="logins"?"Cari karyawan, input, atau IP":"Cari actor, detail, atau ID event"} aria-label="Cari audit portal"/>
      {tab==="logins"?(
        <select value={success} onChange={e=>{setSuccess(e.target.value);setOffset(0)}} aria-label="Filter hasil login">
          <option value="">Semua hasil</option>
          <option value="1">Berhasil</option>
          <option value="0">Gagal</option>
        </select>
      ):(
        <select value={group} onChange={e=>{setGroup(e.target.value);setOffset(0)}} aria-label="Filter kategori event">
          <option value="">Semua event</option>
          <option value="ewa">Advance Salary</option>
          <option value="credentials">Kredensial & password</option>
        </select>
      )}
      <input type="date" value={from} onChange={e=>{setFrom(e.target.value);setOffset(0)}} aria-label="Tanggal mulai"/>
      <input type="date" value={to} onChange={e=>{setTo(e.target.value);setOffset(0)}} aria-label="Tanggal akhir"/>
      <select value={limit} onChange={e=>{setLimit(Number(e.target.value));setOffset(0)}} aria-label="Jumlah baris per halaman">
        <option value={25}>25 baris</option>
        <option value={50}>50 baris</option>
        <option value={100}>100 baris</option>
      </select>
      {(q||success||group||from||to)?<button type="button" className="btn" onClick={()=>{setQ("");setSuccess("");setGroup("");setFrom("");setTo("");setOffset(0)}}>Reset filter</button>:null}
    </div>
    <EmployeeServiceState
      loading={loading && rows.length === 0}
      error={message}
      empty={!loading && !message && rows.length === 0}
      loadingText="Memuat jejak audit portal…"
      emptyTitle={q ? "Tidak ada audit yang cocok" : "Belum ada jejak audit"}
      emptyBody={q ? "Coba kata kunci lain atau reset filter." : "Aktivitas Employee Portal akan muncul di sini."}
      onRetry={() => void load()}
      onReset={q ? () => { setQ(""); setOffset(0); } : undefined}
    />

    {rows.length>0?<div className="card pa-desktop pa-table-wrap">
      {tab==="logins"?<table className="data-table" className="pa-table"><thead><tr><th align="left">Waktu</th><th align="left">Karyawan</th><th align="left">Input</th><th align="left">IP</th><th align="left">Hasil</th><th className="pa-action"/></tr></thead><tbody>{logins.map(row=><tr key={row.id}><td>{when(row.created_at)}</td><td><strong>{row.employee_name||row.employee_id||"—"}</strong><div style={{fontSize:11,color:"var(--text3)"}}>{row.employee_code}</div></td><td>{row.employee_id_input}</td><td>{row.ip}</td><td><span className={`pa-result ${Number(row.success)?"ok":"fail"}`}>{Number(row.success)?"BERHASIL":row.reason||"GAGAL"}</span></td><td className="pa-action"><button type="button" className="btn" onClick={()=>setSelected(row)}>Detail</button></td></tr>)}</tbody></table>
      :<table className="data-table" className="pa-table"><thead><tr><th align="left">Waktu</th><th align="left">Aksi</th><th align="left">Oleh</th><th align="left">Detail</th><th className="pa-action"/></tr></thead><tbody>{events.map(row=><tr key={row.id}><td>{when(row.timestamp)}</td><td><strong>{actionLabel(row.action)}</strong><div style={{fontSize:10,color:"var(--text3)"}}>{row.action}</div></td><td>{row.username} · {row.role}</td><td>{row.detail}{row.entity_id?` · ${row.entity_id}`:""}</td><td className="pa-action"><button type="button" className="btn" onClick={()=>setSelected(row)}>Detail</button></td></tr>)}</tbody></table>}
    </div>:null}

    {rows.length>0?<div className="pa-mobile">
      {tab==="logins"?logins.map(row=><article className="pa-card" key={row.id}><div style={{display:"flex",justifyContent:"space-between",gap:10}}><strong>{row.employee_name||row.employee_id||"—"}</strong><span className={`pa-result ${Number(row.success)?"ok":"fail"}`}>{Number(row.success)?"BERHASIL":"GAGAL"}</span></div><div style={{fontSize:11,color:"var(--text3)",margin:"5px 0 10px"}}>{when(row.created_at)} · {row.ip||"IP tidak tersedia"}</div><button type="button" className="btn" onClick={()=>setSelected(row)}>Detail</button></article>)
      :events.map(row=><article className="pa-card" key={row.id}><strong>{actionLabel(row.action)}</strong><div style={{fontSize:11,color:"var(--text3)",margin:"5px 0"}}>{when(row.timestamp)} · {row.username||"SYSTEM"} · {row.role||"—"}</div><div style={{fontSize:12,marginBottom:10}}>{row.detail||row.entity_id||"Tidak ada detail"}</div><button type="button" className="btn" onClick={()=>setSelected(row)}>Detail</button></article>)}
    </div>:null}

    <div className="portal-toolbar" style={{justifyContent:"space-between"}}><span style={{fontSize:12,color:"var(--text3)"}}>{page.total?`${offset+1}–${Math.min(offset+rows.length,page.total)} dari ${page.total}`:"0 data"}</span><span style={{display:"flex",gap:8}}><button type="button" className="btn" disabled={offset===0||loading} onClick={()=>setOffset(Math.max(0,offset-page.limit))}>Sebelumnya</button><button type="button" className="btn" disabled={!page.hasMore||loading} onClick={()=>setOffset(page.nextOffset)}>Berikutnya</button></span></div>

    {selected?<div className="pa-drawer-backdrop" role="presentation" onMouseDown={e=>{if(e.currentTarget===e.target)setSelected(null)}}>
      <aside className="pa-drawer" role="dialog" aria-modal="true" aria-labelledby="pa-detail-title">
        <div className="pa-drawer-head">
          <div><span className="page-eyebrow">Detail audit</span><h2 id="pa-detail-title" style={{margin:"4px 0"}}>{"created_at" in selected?"Login activity":actionLabel(selected.action)}</h2><div style={{fontSize:11,color:"var(--text3)"}}>{"created_at" in selected?selected.id:selected.action}</div></div>
          <button type="button" className="btn" onClick={()=>setSelected(null)}>Tutup</button>
        </div>
        {"created_at" in selected?<div className="pa-detail"><div><span>Waktu</span>{when(selected.created_at)}</div><div><span>Karyawan</span>{selected.employee_name||selected.employee_id||"—"}</div><div><span>Input login</span>{selected.employee_id_input||"—"}</div><div><span>IP</span>{selected.ip||"—"}</div><div><span>Hasil</span>{Number(selected.success)?"BERHASIL":selected.reason||"GAGAL"}</div><div><span>ID event</span>{selected.id}</div></div>:<div className="pa-detail"><div><span>Waktu</span>{when(selected.timestamp)}</div><div><span>Aksi</span>{actionLabel(selected.action)}<div style={{fontSize:10,color:"var(--text3)"}}>{selected.action}</div></div><div><span>Actor</span>{selected.username||"SYSTEM"} · {selected.role||"—"}</div><div><span>Entity</span>{selected.entity||"—"} · {selected.entity_id||"—"}</div><div style={{gridColumn:"1 / -1"}}><span>Detail</span>{selected.detail||"—"}</div><div><span>ID event</span>{selected.id}</div></div>}
      </aside>
    </div>:null}
  </section>
}

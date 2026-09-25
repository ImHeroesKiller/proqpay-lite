"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type EwaRow = {
  id: string;
  employee_id: string;
  employee_name?: string;
  employee_code?: string;
  client_id?: string;
  client_name?: string;
  period: string;
  amount: number;
  fee: number;
  repayment: number;
  status: string;
  created_at: string;
  approved_by?: string;
  approved_at?: string;
  disbursed_by?: string;
  disbursed_at?: string;
  disbursement_source?: string;
  disbursement_reference?: string;
  disbursement_transaction_date?: string;
  destination_bank_name?: string;
  destination_account_last4?: string;
};

type ClientFacet = { id: string; name: string };
type StatusCounts = Record<string, number>;

const STATUSES = ["SUBMITTED","APPROVED","DISBURSED","REPAYING","REPAID","REJECTED","CANCELLED"] as const;
const LABEL: Record<string,string> = {
  SUBMITTED:"Menunggu approval", APPROVED:"Disetujui", DISBURSED:"Sudah dicairkan",
  REPAYING:"Potong payroll", REPAID:"Lunas", REJECTED:"Ditolak", CANCELLED:"Dibatalkan",
};
const IDR = new Intl.NumberFormat("id-ID",{style:"currency",currency:"IDR",maximumFractionDigits:0});
const fmtDate=(value?:string)=>value ? String(value).replace("T"," ").slice(0,16) : "—";

export default function EwaInbox() {
  const [rows,setRows]=useState<EwaRow[]>([]);
  const [pending,setPending]=useState(0);
  const [total,setTotal]=useState(0);
  const [status,setStatus]=useState("SUBMITTED");
  const [q,setQ]=useState("");
  const [period,setPeriod]=useState("");
  const [clientId,setClientId]=useState("");
  const [clients,setClients]=useState<ClientFacet[]>([]);
  const [counts,setCounts]=useState<StatusCounts>({});
  const [offset,setOffset]=useState(0);
  const [page,setPage]=useState({total:0,hasMore:false,nextOffset:0,limit:50});
  const [loading,setLoading]=useState(true);
  const [message,setMessage]=useState("");
  const [busy,setBusy]=useState("");
  const [selected,setSelected]=useState<EwaRow|null>(null);

  const load=useCallback(async()=>{
    setLoading(true); setMessage("");
    const params=new URLSearchParams({status,offset:String(offset),limit:"50"});
    if(q.trim()) params.set("q",q.trim());
    if(/^\d{4}-\d{2}$/.test(period)) params.set("period",period);
    if(clientId) params.set("clientId",clientId);
    try{
      const response=await fetch(`/api/ewa?${params.toString()}`,{cache:"no-store"});
      const data=await response.json().catch(()=>({}));
      if(!response.ok) throw new Error(data.error||`HTTP ${response.status}`);
      setRows(data.requests||[]);
      setPending(Number(data.pending||0));
      setTotal(Number(data.total||0));
      setClients(data.clients||[]);
      setCounts(data.statusCounts||{});
      setPage({
        total:Number(data.filteredTotal||0),
        hasMore:Boolean(data.page?.hasMore),
        nextOffset:Number(data.page?.nextOffset||0),
        limit:Number(data.page?.limit||50),
      });
    }catch(error){
      setMessage(error instanceof Error?error.message:"Gagal memuat Employee Services");
    }finally{setLoading(false);}
  },[status,q,period,clientId,offset]);

  useEffect(()=>{void load();},[load]);

  const resetFilters=()=>{setQ("");setPeriod("");setClientId("");setOffset(0);};
  const hasFilters=Boolean(q||period||clientId);

  async function act(id:string,action:string,extra:Record<string,string>={}){
    if(busy)return;
    setBusy(id+action); setMessage("");
    try{
      const response=await fetch("/api/ewa",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id,action,...extra})});
      const data=await response.json().catch(()=>({}));
      if(!response.ok) throw new Error(data.error||`HTTP ${response.status}`);
      setSelected(null);
      await load();
    }catch(error){setMessage(error instanceof Error?error.message:"Gagal memproses");}
    finally{setBusy("");}
  }

  async function disburse(id:string){
    const source=window.prompt("Sumber pencairan (contoh: E2PAY, BANK_TRANSFER):","BANK_TRANSFER")?.trim();
    if(!source)return;
    const reference=window.prompt("Nomor referensi transaksi:")?.trim();
    if(!reference)return;
    const transactionDate=window.prompt("Tanggal transaksi (YYYY-MM-DD):",new Date().toISOString().slice(0,10))?.trim();
    if(!transactionDate)return;
    await act(id,"DISBURSE",{source,reference,transactionDate});
  }

  const visibleSummary=useMemo(()=>[
    {key:"SUBMITTED",label:"Menunggu",value:counts.SUBMITTED||0},
    {key:"APPROVED",label:"Siap cair",value:counts.APPROVED||0},
    {key:"DISBURSED",label:"Dicairkan",value:counts.DISBURSED||0},
    {key:"REPAYING",label:"Dalam payroll",value:counts.REPAYING||0},
  ],[counts]);

  return (
    <section className="portal-workspace">
      <style>{`
        .ewa-summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:14px 0}
        .ewa-summary button{background:var(--card,#fff);border:1px solid var(--border);border-radius:14px;padding:13px;text-align:left;cursor:pointer;color:inherit}
        .ewa-summary b{display:block;font-size:20px}.ewa-summary span{font-size:11px;color:var(--text3)}
        .ewa-mobile{display:none}.ewa-row-actions{display:flex;gap:6px;flex-wrap:wrap}.ewa-status{white-space:nowrap}
        .ewa-detail-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;font-size:12px}
        .ewa-detail-grid div{padding:10px;border:1px solid var(--border);border-radius:10px}.ewa-detail-grid span{display:block;color:var(--text3);font-size:10px;margin-bottom:3px}
        @media(max-width:760px){
          .ewa-summary{grid-template-columns:repeat(2,minmax(0,1fr))}
          .ewa-desktop{display:none}.ewa-mobile{display:grid;gap:10px}
          .ewa-mobile-card{border:1px solid var(--border);border-radius:14px;padding:14px;background:var(--card,#fff)}
          .ewa-mobile-top{display:flex;justify-content:space-between;gap:10px}.ewa-mobile-money{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:12px 0}
          .ewa-mobile-money div{background:var(--surface);border-radius:10px;padding:9px}.ewa-detail-grid{grid-template-columns:1fr}
        }
      `}</style>

      <div className="page-heading">
        <div>
          <span className="page-eyebrow">Employee portal</span>
          <h1>Advance Salary</h1>
          <p>Kontrol lifecycle advance dari pengajuan sampai lunas. Status lunas hanya berasal dari rekonsiliasi payroll.</p>
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          <span className="status-pill">{pending} menunggu</span>
          <button type="button" className="btn" onClick={()=>void load()} disabled={loading}>{loading?"Memuat…":"Refresh"}</button>
        </div>
      </div>

      <div className="ewa-summary" aria-label="Ringkasan lifecycle">
        {visibleSummary.map(item=>(
          <button key={item.key} type="button" onClick={()=>{setStatus(item.key);setOffset(0);}}>
            <b>{item.value}</b><span>{item.label}</span>
          </button>
        ))}
      </div>

      <div className="portal-toolbar">
        {STATUSES.map(value=>(
          <button key={value} type="button" className={`btn${status===value?" btn-primary":""}`} onClick={()=>{setStatus(value);setOffset(0);}}>
            {LABEL[value]} ({counts[value]||0})
          </button>
        ))}
        <button type="button" className={`btn${status===""?" btn-primary":""}`} onClick={()=>{setStatus("");setOffset(0);}}>Semua ({total})</button>
      </div>

      <div className="portal-toolbar">
        <input value={q} onChange={e=>{setQ(e.target.value);setOffset(0);}} placeholder="Cari nama, kode, atau ID pengajuan" aria-label="Cari pengajuan advance"/>
        <select value={clientId} onChange={e=>{setClientId(e.target.value);setOffset(0);}} aria-label="Filter klien">
          <option value="">Semua klien</option>{clients.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <input type="month" value={period} onChange={e=>{setPeriod(e.target.value);setOffset(0);}} aria-label="Filter periode"/>
        {hasFilters?<button type="button" className="btn" onClick={resetFilters}>Reset filter</button>:null}
      </div>

      {message?(
        <div className="app-notice-bubble app-notice-error" role="alert" style={{display:"flex",justifyContent:"space-between",gap:12,alignItems:"center"}}>
          <span>{message}</span><button type="button" className="btn" onClick={()=>void load()}>Coba lagi</button>
        </div>
      ):null}

      {loading && rows.length===0?<div className="card" aria-busy="true" style={{padding:24,color:"var(--text3)"}}>Memuat pengajuan Employee Services…</div>:null}

      {!loading && !message && rows.length===0?(
        <div className="card" style={{padding:24,textAlign:"center"}}>
          <strong>{hasFilters||status?"Tidak ada pengajuan yang cocok":"Belum ada pengajuan advance"}</strong>
          <p style={{color:"var(--text3)",margin:"6px 0 12px"}}>{hasFilters?"Ubah atau reset filter untuk melihat data lain.":"Pengajuan baru dari ESS akan muncul di sini."}</p>
          {hasFilters?<button type="button" className="btn" onClick={resetFilters}>Reset filter</button>:null}
        </div>
      ):null}

      {rows.length>0?<>
        <div className="card ewa-desktop" style={{overflowX:"auto"}}>
          <table className="data-table" style={{width:"100%",borderCollapse:"collapse"}}>
            <thead><tr><th align="left">Karyawan</th><th align="left">Periode</th><th align="right">Cair</th><th align="right">Potong gaji</th><th align="left">Status</th><th align="left">Update</th><th/></tr></thead>
            <tbody>{rows.map(row=>(
              <tr key={row.id}>
                <td><strong>{row.employee_name||row.employee_id}</strong><div style={{fontSize:11,color:"var(--text3)"}}>{row.employee_code} · {row.client_name}</div></td>
                <td>{row.period}</td><td align="right">{IDR.format(row.amount||0)}</td><td align="right">{IDR.format(row.repayment||0)}</td>
                <td className="ewa-status">{LABEL[row.status]||row.status}</td><td>{fmtDate(row.disbursed_at||row.approved_at||row.created_at)}</td>
                <td><div className="ewa-row-actions">
                  <button type="button" className="btn" onClick={()=>setSelected(row)}>Detail</button>
                  {row.status==="SUBMITTED"?<>
                    <button type="button" className="btn btn-primary" disabled={Boolean(busy)} onClick={()=>void act(row.id,"APPROVE")}>Setujui</button>
                    <button type="button" className="btn" disabled={Boolean(busy)} onClick={()=>void act(row.id,"REJECT")}>Tolak</button>
                  </>:row.status==="APPROVED"?<button type="button" className="btn btn-primary" disabled={Boolean(busy)} onClick={()=>void disburse(row.id)}>Catat pencairan</button>:null}
                </div></td>
              </tr>
            ))}</tbody>
          </table>
        </div>

        <div className="ewa-mobile">
          {rows.map(row=><article className="ewa-mobile-card" key={row.id}>
            <div className="ewa-mobile-top"><div><strong>{row.employee_name||row.employee_id}</strong><div style={{fontSize:11,color:"var(--text3)"}}>{row.employee_code} · {row.client_name}</div></div><span className="status-pill">{LABEL[row.status]||row.status}</span></div>
            <div className="ewa-mobile-money"><div><small>Cair</small><strong>{IDR.format(row.amount||0)}</strong></div><div><small>Potong gaji</small><strong>{IDR.format(row.repayment||0)}</strong></div></div>
            <div style={{fontSize:11,color:"var(--text3)",marginBottom:10}}>{row.period} · {fmtDate(row.disbursed_at||row.approved_at||row.created_at)}</div>
            <div className="ewa-row-actions"><button type="button" className="btn" onClick={()=>setSelected(row)}>Detail</button>{row.status==="SUBMITTED"?<><button type="button" className="btn btn-primary" disabled={Boolean(busy)} onClick={()=>void act(row.id,"APPROVE")}>Setujui</button><button type="button" className="btn" disabled={Boolean(busy)} onClick={()=>void act(row.id,"REJECT")}>Tolak</button></>:row.status==="APPROVED"?<button type="button" className="btn btn-primary" disabled={Boolean(busy)} onClick={()=>void disburse(row.id)}>Catat pencairan</button>:null}</div>
          </article>)}
        </div>
      </>:null}

      <div className="portal-toolbar" style={{justifyContent:"space-between"}}>
        <span style={{fontSize:12,color:"var(--text3)"}}>{page.total?`${offset+1}–${Math.min(offset+rows.length,page.total)} dari ${page.total}`:"0 data"}</span>
        <span style={{display:"flex",gap:8}}><button type="button" className="btn" disabled={offset===0||loading} onClick={()=>setOffset(Math.max(0,offset-page.limit))}>Sebelumnya</button><button type="button" className="btn" disabled={!page.hasMore||loading} onClick={()=>setOffset(page.nextOffset)}>Berikutnya</button></span>
      </div>

      {selected?<div className="card" role="dialog" aria-label="Detail lifecycle advance" style={{marginTop:12}}>
        <div style={{display:"flex",justifyContent:"space-between",gap:12,alignItems:"center",marginBottom:12}}><div><strong>{selected.id}</strong><div style={{fontSize:12,color:"var(--text3)"}}>{selected.employee_name} · {LABEL[selected.status]||selected.status}</div></div><button type="button" className="btn" onClick={()=>setSelected(null)}>Tutup</button></div>
        <div className="ewa-detail-grid">
          <div><span>Diajukan</span>{fmtDate(selected.created_at)}</div>
          <div><span>Disetujui</span>{fmtDate(selected.approved_at)} · {selected.approved_by||"—"}</div>
          <div><span>Dicairkan</span>{fmtDate(selected.disbursed_at)} · {selected.disbursed_by||"—"}</div>
          <div><span>Bukti transaksi</span>{selected.disbursement_source||"—"} · {selected.disbursement_reference||"—"}</div>
          <div><span>Rekening tujuan</span>{selected.destination_bank_name||"—"} · •••• {selected.destination_account_last4||"—"}</div>
          <div><span>Nilai</span>{IDR.format(selected.amount||0)} + fee {IDR.format(selected.fee||0)}</div>
        </div>
      </div>:null}
    </section>
  );
}

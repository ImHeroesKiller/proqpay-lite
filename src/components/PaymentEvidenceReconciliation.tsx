'use client';

import { formatIDR } from '@/lib/format';
import {
  paymentEvidenceCoverage,
  paymentProofFileLabel,
  reconciliationControl,
  settlementSourceLabel,
  shortEvidenceFingerprint,
  type PaymentInstructionDetail,
  type PaymentProofRecord,
  type ReconciliationRecord,
} from '@/lib/payment-instruction-ui';

const small:React.CSSProperties={display:'block',color:'var(--text3)',fontSize:11,marginTop:3};
const th:React.CSSProperties={textAlign:'left',padding:'11px 14px',background:'var(--bg-subtle)',color:'var(--text2)',fontSize:10.5,textTransform:'uppercase',whiteSpace:'nowrap'};
const td:React.CSSProperties={padding:'12px 14px',verticalAlign:'middle'};

const date=(value:string)=>value?new Date(value).toLocaleDateString('id-ID'):'-';
const dateTime=(value:string)=>value?new Date(value).toLocaleString('id-ID',{dateStyle:'medium',timeStyle:'short'}):'-';

export function PaymentReconciliationControl({
  detail,
  current,
}:{
  detail:PaymentInstructionDetail;
  current?:ReconciliationRecord|null;
}) {
  const latest=detail.reconciliationHistory?.[0]||current||null;
  const summary=reconciliationControl(latest);
  const coverage=paymentEvidenceCoverage(Number(detail.control.expectedTotal||0),Number(detail.proofSummary?.proof_total||0));
  return <section className="pi-approval-section" aria-label="Payment reconciliation control">
    <div className="pi-section-heading">
      <div><span>RECONCILIATION CONTROL</span><h4>Expected vs settlement</h4></div>
      <small>{detail.reconciliationHistory?.length||0} review attempt</small>
    </div>
    <div className="pi-detail-summary">
      <div><span>Expected PI</span><strong>{formatIDR(Number(detail.control.expectedTotal||0))}</strong></div>
      <div><span>Evidence recorded</span><strong>{formatIDR(coverage.evidence)}</strong><small>{coverage.percent}% coverage</small></div>
      <div><span>Settlement source</span><strong>{summary?.source?settlementSourceLabel(summary.source):'Belum ditetapkan'}</strong></div>
      <div className="pi-detail-total"><span>Difference</span><strong>{formatIDR(summary?.difference??(coverage.evidence-Number(detail.control.expectedTotal||0)))}</strong></div>
    </div>
    {summary
      ? <div className={`app-notice-bubble ${summary.matched?'app-notice-info':'app-notice-error'}`}>
          <strong>{summary.matched?'Settlement matched':'Settlement perlu perhatian'}</strong>
          <span>{summary.reviewer||'Controller'} · {dateTime(summary.createdAt)}</span>
        </div>
      : <p className="directory-hint">Rekonsiliasi final belum dilakukan.</p>}
    {detail.reconciliationHistory?.length
      ? <div className="pi-approval-list">{detail.reconciliationHistory.slice(0,10).map((attempt)=>
          <div key={attempt.id}>
            <i>{attempt.status==='MATCHED'?'✓':'!'}</i>
            <div>
              <strong>{attempt.status} · {settlementSourceLabel(attempt.settlement_source)}</strong>
              <span>{attempt.reviewed_by} · {dateTime(attempt.created_at)}</span>
              <small>Expected {formatIDR(Number(attempt.expected_total||0))} · Settlement {formatIDR(Number(attempt.settlement_total||0))} · Difference {formatIDR(Number(attempt.difference||0))}</small>
            </div>
          </div>)}</div>
      : null}
  </section>;
}

export function PaymentEvidenceRegister({proofs}:{proofs:PaymentProofRecord[]}) {
  if(!proofs.length)return null;
  return <section className="card" style={{padding:0,overflow:'hidden'}}>
    <div style={{padding:'16px 18px',borderBottom:'1px solid var(--border-soft)'}}>
      <strong>Payment Evidence Register</strong>
      <small style={small}>Jejak bukti pembayaran, referensi bank, uploader, dan fingerprint file.</small>
    </div>
    <div style={{overflowX:'auto'}}>
      <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
        <thead><tr><th style={th}>PI / Referensi</th><th style={th}>Tanggal</th><th style={th}>Nominal</th><th style={th}>Evidence</th><th style={th}>Uploader</th><th style={th}>Aksi</th></tr></thead>
        <tbody>{proofs.slice(0,100).map((row)=>
          <tr key={row.id} style={{borderBottom:'1px solid var(--border-soft)'}}>
            <td style={td}><strong>{row.bank} · {row.reference}</strong><small style={small}>{row.payment_instruction_id}</small></td>
            <td style={td}>{date(row.transaction_date)}</td>
            <td style={td}><strong>{formatIDR(Number(row.amount||0))}</strong></td>
            <td style={td}><span>{paymentProofFileLabel(row.mime_type)}</span><small style={small}>{row.file_size?`${(Number(row.file_size)/1024).toFixed(1)} KB · `:''}{shortEvidenceFingerprint(row.file_sha256)}</small></td>
            <td style={td}>{row.uploaded_by||'Legacy record'}</td>
            <td style={td}><a className="btn" href={`/api/payment-proof?id=${encodeURIComponent(row.id)}`} target="_blank" rel="noreferrer">Unduh</a></td>
          </tr>)}</tbody>
      </table>
    </div>
    {proofs.length>100?<div style={{padding:12}}><small style={small}>Menampilkan 100 bukti terbaru dari {proofs.length.toLocaleString('id-ID')} record yang sudah dimuat.</small></div>:null}
  </section>;
}

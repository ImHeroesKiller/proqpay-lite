'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import DismissibleBubble from '@/components/ui/DismissibleBubble';
import { assessE2PayScenario, formatE2PayTechnicalJson, E2PAY_TEST_SCRIPT } from '@/lib/e2pay-test-script';
import { formatIDR } from '@/lib/format';
import {
  E2PayApiError,
  getE2PayBanks,
  getE2PayCatalog,
  getE2PayOverview,
  getE2PayTransactions,
  getE2PayUatValidation,
  runE2PayAction,
  type E2PayAccountSnapshot,
  type E2PayUatLane,
  type E2PayCatalogItem,
  type E2PayTransactionRow,
} from '@/lib/e2pay-api';

type Props={ canManage:boolean };

const E2PAY_UAT_DUMMY={accountId:'701075327',bankId:'permata',amount:'15000'} as const;

const TECHNICAL_TABS=[
  ...Array.from(new Set<string>(E2PAY_TEST_SCRIPT.map(([,category])=>category))).map(category=>[category,category] as const),
  ['diagnostics','Diagnostics'],
  ['inquiry','Disbursement inquiry'],
  ['password','Password administration'],
  ['phone','Phone number administration'],
] as const;

const QUICK_TEST_LABELS: Partial<Record<number,string>> = {
  1:'Get Access Token',
  9:'Get Authorization',
  10:'Get OAuth Token',
  17:'Get Account',
  19:'Get History',
  20:'Get History · Limit 100',
  22:'Get Bank List',
};

type TechnicalTab=typeof TECHNICAL_TABS[number][0];
type TechnicalOutput={request:string;response:string};

function dateTime(value?:string|null){
  if(!value) return '—';
  const date=new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('id-ID');
}

function endpointMode(mode:E2PayCatalogItem['mode']){
  if(mode==='PAYMENT_CONTROL_ONLY') return 'Payment Control';
  if(mode==='SERVER_MANAGED') return 'Server managed';
  if(mode==='ADMIN_ACTION') return 'Admin action';
  if(mode==='LIVE_READ') return 'Live read';
  return 'Diagnostic';
}

function Field({label,type='text',value,onChange,placeholder}:{label:string;type?:string;value:string;onChange:(value:string)=>void;placeholder?:string}){
  return <label><span>{label}</span><input type={type} value={value} onChange={(event)=>onChange(event.target.value)} placeholder={placeholder} autoComplete="off" /></label>;
}

export default function E2PayOperationsConsole({canManage}:Props){
  const endpointDialog=useRef<HTMLDialogElement>(null);
  const [requestedTab,setActiveTab]=useState<'wallet'|'uat'|'activity'|'technical'>('wallet');
  const [account,setAccount]=useState<E2PayAccountSnapshot|null>(null);
  const isUat=String(account?.environment||'').toUpperCase()==='UAT';
  const activeTab=requestedTab==='uat'&&!isUat?'wallet':requestedTab;
  const tabs=([['wallet','Wallet'],['uat','UAT'],['activity','Riwayat & bank'],['technical','Teknis']] as const)
    .filter(([id])=>id!=='uat'||isUat);
  const [catalog,setCatalog]=useState<E2PayCatalogItem[]>([]);
  const [banks,setBanks]=useState<Array<{id:string;name:string;active:string|boolean}>>([]);
  const [banksLoaded,setBanksLoaded]=useState(false);
  const [transactions,setTransactions]=useState<E2PayTransactionRow[]>([]);
  const [transactionsLoaded,setTransactionsLoaded]=useState(false);
  const [transactionPage,setTransactionPage]=useState({
    offset:0,hasNext:false,filters:{} as Record<string,string|undefined>,
  });
  const [transactionCount,setTransactionCount]=useState(0);
  const [loading,setLoading]=useState(false);
  const [actionLoading,setActionLoading]=useState('');
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [bankSearch,setBankSearch]=useState('');
  const [txClientRef,setTxClientRef]=useState('');
  const [txResponseCode,setTxResponseCode]=useState('');
  const [txFrom,setTxFrom]=useState('');
  const [txUntil,setTxUntil]=useState('');
  const [inquiry,setInquiry]=useState({accountId:'',bankId:'',amount:''});
  const [registration,setRegistration]=useState({phone:'',name:'',email:'',partnerId:'',sourceId:'',username:'',token:'',password:''});
  const [reset,setReset]=useState({email:'',accountGroupId:'',token:'',newPassword:''});
  const [password,setPassword]=useState({password:'',newPassword:''});
  const [phone,setPhone]=useState({password:'',phone:'',token:''});
  const [technicalTab,setTechnicalTab]=useState<TechnicalTab>('Registration');
  const [scriptIndex,setScriptIndex]=useState(1);
  const [scriptInput,setScriptInput]=useState('');
  const scriptCases=E2PAY_TEST_SCRIPT.filter(([,category])=>category===technicalTab);
  const selectedScript=scriptCases.find(([id])=>id===scriptIndex)||scriptCases[0];
  const scriptId=selectedScript?.[0];
  const outputKey=scriptId ? `script-${scriptId}` : technicalTab;
  const [technicalOutputs,setTechnicalOutputs]=useState<Partial<Record<TechnicalTab,TechnicalOutput>>>({});
  const technicalOutput=technicalOutputs[outputKey];
  const [topUpOpen,setTopUpOpen]=useState(false);
  const [copied,setCopied]=useState('');
  const [uatValidation,setUatValidation]=useState<{canary:E2PayUatLane|null;batch:E2PayUatLane|null;protocol:string[]} | null>(null);

  const loadOverview=useCallback(async(force=false)=>{
    setLoading(true);setError('');
    const [overviewResult,catalogResult]=await Promise.allSettled([getE2PayOverview(force),getE2PayCatalog()]);
    if(catalogResult.status==='fulfilled') setCatalog(catalogResult.value.catalog);
    if(overviewResult.status==='fulfilled') setAccount(overviewResult.value.account);
    else setError(overviewResult.reason instanceof Error?overviewResult.reason.message:'E2Pay overview gagal dimuat');
    if(catalogResult.status==='rejected' && overviewResult.status==='fulfilled'){
      setError(catalogResult.reason instanceof Error?catalogResult.reason.message:'Catalog E2Pay gagal dimuat');
    }
    setLoading(false);
  },[]);

  const loadUatValidation=useCallback(async()=>{
    try{
      const result=await getE2PayUatValidation();
      setUatValidation({canary:result.canary,batch:result.batch,protocol:result.protocol});
    }catch{
      setUatValidation(null);
    }
  },[]);

  useEffect(()=>{void loadOverview(false);},[loadOverview]);
  useEffect(()=>{if(isUat) void loadUatValidation();},[isUat,loadUatValidation]);

  useEffect(()=>{
    if(String(account?.environment||'').toUpperCase()!=='UAT') return;
    setInquiry((current)=>{
      if(current.accountId||current.bankId||current.amount) return current;
      return {...E2PAY_UAT_DUMMY};
    });
  },[account?.environment]);

  const run=useCallback(async(action:string,payload:Record<string,unknown>={},read?:()=>Promise<Record<string,unknown>>,resultKey=outputKey)=>{
    const request=formatE2PayTechnicalJson(read ? {method:'GET',endpoint:'/api/e2pay-operations',query:payload} : {method:'POST',endpoint:'/api/e2pay-operations',body:{action,...payload}});
    const setLastResult=(response:string)=>setTechnicalOutputs(current=>({...current,[resultKey]:{request,response}}));
    const scenarioId=resultKey.startsWith('script-')?Number(resultKey.slice(7)):0;
    const recordResult=(result:Record<string,unknown>)=>{
      const assessment=assessE2PayScenario(scenarioId,result);
      setLastResult(formatE2PayTechnicalJson({...result,assessment}));
      return assessment;
    };
    setActionLoading(action);setError('');setNotice('');setLastResult('');
    try{
      const result=await (read ? read() : runE2PayAction(action,payload));
      let assessment;
      if(action==='REGISTER_REQUEST'||action==='REGISTER_CONFIRM'){
        const evidence=result.registration as Record<string,unknown>|null;
        const {merchantRegistrationId,merchantId,accountGroupId,username,tokenPrefix}=evidence||{};
        assessment=recordResult({ok:true,action,correlationId:result.correlationId,merchantRegistrationId,merchantId,accountGroupId,tokenPrefixReceived:Boolean(tokenPrefix)});
        if(action==='REGISTER_REQUEST' && typeof username==='string'){
          setRegistration(current=>({...current,username}));
        }
      }else{
        assessment=recordResult(result);
      }
      if(assessment?.status==='Failed') setError('Failed · respons tidak sesuai Expected Result.');
      else setNotice(assessment ? 'Passed · respons sesuai Expected Result.' : `${action.replaceAll('_',' ')} berhasil.`);
      if(['REFRESH_ACCOUNT','CHANGE_PASSWORD','RESET_PASSWORD_CONFIRM','CHANGE_PHONE_CONFIRM'].includes(action)) void loadOverview(true);
      return result;
    }catch(cause){
      if(cause instanceof E2PayApiError){
        const {status,code,stage,providerStatus,providerCode,providerRefId,providerReason,correlationId}=cause;
        const assessment=recordResult({ok:false,action,status,code,stage,providerStatus,providerCode,providerRefId,providerReason,correlationId});
        if(assessment?.status==='Passed'){
          setNotice('Passed · penolakan E2Pay sesuai Expected Result.');
          return null;
        }
      }else{
        recordResult({ok:false,action,code:'REQUEST_FAILED'});
      }
      setError(cause instanceof Error?cause.message:'Operasi E2Pay gagal');
      return null;
    }finally{setActionLoading('');}
  },[loadOverview,outputKey]);

  async function loadBanks(){
    setActionLoading('BANKS');setError('');
    try{
      const result=await getE2PayBanks({name:bankSearch||undefined,limit:1000});
      setBanks(result.data);setBanksLoaded(true);
    }catch(cause){
      setBanksLoaded(false);
      setError(cause instanceof Error?cause.message:'Bank list gagal dimuat');
    }finally{setActionLoading('');}
  }

  async function loadTransactions(offset=0,reuseFilters=false){
    const filters=!reuseFilters?{
      clientRef:txClientRef.trim()||undefined,
      responseCode:txResponseCode||undefined,
      transactionTimestampFrom:txFrom ? txFrom+' 00:00:00' : undefined,
      transactionTimestampUntil:txUntil ? txUntil+' 23:59:59' : undefined,
    }:transactionPage.filters;
    setActionLoading('TRANSACTIONS');setError('');
    try{
      const result=await getE2PayTransactions({...filters,limit:50,offset});
      setTransactions(result.data);
      setTransactionCount(result.rowCount);
      setTransactionsLoaded(true);
      setTransactionPage({offset,filters,hasNext:result.data.length>0&&(result.data.length===50||result.rowCount>offset+result.data.length)});
    }catch(cause){
      setError(cause instanceof Error?cause.message:'Transaction history gagal dimuat');
    }finally{setActionLoading('');}
  }

  async function copyText(label:string,value?:string|null){
    if(!value) return;
    try{
      if(navigator.clipboard?.writeText){
        await navigator.clipboard.writeText(value);
      }else{
        const textarea=document.createElement('textarea');
        textarea.value=value;
        textarea.setAttribute('readonly','');
        textarea.style.position='fixed';
        textarea.style.opacity='0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        textarea.remove();
      }
      setCopied(label);
      window.setTimeout(()=>setCopied(''),1800);
    }catch{
      setCopied('');
      setError('Informasi Top Up gagal disalin. Salin data VA secara manual.');
    }
  }

  const fundingClipboardText=useMemo(()=>{
    const funding=account?.funding;
    if(!funding?.vaNumber) return '';
    const environment=String(account?.environment||'').toUpperCase()||'—';
    const lines=[
      'TOP UP WALLET E2PAY',
      `Environment: ${environment}`,
      `Bank Tujuan: ${funding.bankName||'Belum dikonfigurasi'}`,
      `Virtual Account (VA): ${funding.vaNumber}`,
      `Nama Akun: ${funding.accountName||account?.accountName||'—'}`,
      'Provider: E2Pay',
    ];
    if(account?.refreshedAt) lines.push(`Terakhir Dicek: ${dateTime(account.refreshedAt)}`);
    if(environment==='UAT'){
      lines.push('Catatan: VA di atas untuk top up wallet E2Pay UAT. Dummy disbursement Permata 701075327 bukan rekening top up.');
    }
    return lines.join('\n');
  },[account]);

  const endpointCounts=useMemo(()=>{
    const map=new Map<string,number>();
    for(const item of catalog) map.set(item.mode,(map.get(item.mode)||0)+1);
    return map;
  },[catalog]);

  return <section className="e2pay-console e2pay-console-compact" aria-label="E2Pay API Operations Console" aria-busy={loading||Boolean(actionLoading)}>
    <div className="e2pay-console-head">
      <div><span className="workspace-eyebrow">E2PAY B2B API v1.1</span><h4>Provider Operations</h4></div>
      <button type="button" className="btn" disabled={loading} onClick={()=>void loadOverview(true)}>{loading?'Refreshing…':'Refresh provider'}</button>
    </div>

    {error?<DismissibleBubble className="app-notice-bubble app-notice-error" role="alert"><strong>E2Pay operation gagal</strong><span>{error}</span></DismissibleBubble>:null}
    {notice?<DismissibleBubble className="app-notice-bubble app-notice-info" role="status"><span>{notice}</span></DismissibleBubble>:null}
    {account?.executionContract && !account.executionContract.valid?<DismissibleBubble className="app-notice-bubble app-notice-error" role="alert">
      <strong>Execution contract belum valid</strong>
      <span>{account.executionContract.issues.join(', ')}. Financial POST akan diblokir sampai source account/password/source ID memenuhi kontrak E2Pay.</span>
    </DismissibleBubble>:null}
    {account?.executionContract?.sourceIdConfigured?<DismissibleBubble className="app-notice-bubble app-notice-info" role="note">
      <strong>Source ID berasal dari provisioning E2Pay</strong>
      <span>ProQPay dapat memastikan Source ID terkonfigurasi, tetapi SSD tidak menyediakan read-only endpoint untuk memvalidasi nilainya sebelum transaksi. Nilai ini harus mengikuti Source ID resmi dari E2Pay.</span>
    </DismissibleBubble>:null}

    <div className="e2pay-console-tabs" role="tablist" aria-label="Bagian Payment Gateway">
      {tabs.map(([id,label],index)=><button key={id} type="button" role="tab" id={`e2pay-tab-${id}`} aria-selected={activeTab===id} aria-controls={`e2pay-panel-${id}`} tabIndex={activeTab===id?0:-1} className={activeTab===id?'btn btn-primary':'btn'} onClick={()=>setActiveTab(id)} onKeyDown={(event)=>{if(event.key!=='ArrowRight'&&event.key!=='ArrowLeft')return;event.preventDefault();const [next]=tabs[(index+(event.key==='ArrowRight'?1:tabs.length-1))%tabs.length];setActiveTab(next);document.getElementById(`e2pay-tab-${next}`)?.focus();}}>{label}</button>)}
    </div>
    <div id="e2pay-panel-wallet" role="tabpanel" aria-labelledby="e2pay-tab-wallet" hidden={activeTab!=='wallet'}>
    <div className="e2pay-account-hero">
      <div className="e2pay-account-balance">
        <span>Available balance</span>
        <strong>{account?.balance!==null&&account?.balance!==undefined?formatIDR(Number(account.balance)):'—'}</strong>
        <small>{account?.environment||'—'} · {account?.merchantStatus||'status unavailable'}</small>
        <button
          type="button"
          className="btn btn-primary e2pay-topup-button"
          aria-expanded={topUpOpen}
          onClick={()=>setTopUpOpen((open)=>!open)}
        >
          {topUpOpen?'Tutup Top Up':'+ Top Up Wallet'}
        </button>
      </div>
      <details className="e2pay-account-meta e2pay-wallet-details">
        <summary>Detail akun dan kesiapan eksekusi</summary>
        <div><span>Merchant</span><strong>{account?.accountName||'—'}</strong><small>{account?.accountIdMasked||'—'}</small></div>
        <div><span>Account group</span><strong>{account?.accountGroupName||'—'}</strong><small>{account?.phoneMasked||'Phone unavailable'}</small></div>
        <div><span>Last sync</span><strong>{dateTime(account?.refreshedAt)}</strong><small>{account?.readiness?.configured?'Execution ready':account?.readiness?.reason||'Not ready'}</small></div>
        <div>
          <span>Execution contract</span>
          <strong>{account?.executionContract?.valid?'VALID':'CHECK REQUIRED'}</strong>
          <small>
            {account?.executionContract?.accountSrcMatchesMerchant===true
              ? 'Source account cocok dengan Merchant Account'
              : account?.executionContract?.accountSrcMatchesMerchant===false
                ? 'Source account tidak cocok dengan Merchant Account'
                : 'Source account belum dapat dicross-check'}
          </small>
        </div>
      </details>
    </div>

    {topUpOpen?<section className="e2pay-topup-card" aria-label="Top Up Wallet E2Pay">
      <div className="e2pay-topup-head">
        <div>
          <span className="workspace-eyebrow">WALLET FUNDING</span>
          <h5>Top Up Wallet</h5>
          <p>Transfer dana ke Virtual Account merchant E2Pay, lalu refresh saldo setelah transfer berhasil.</p>
        </div>
        <span className={account?.funding?.ready?'integration-health-pill integration-health-healthy':'integration-health-pill integration-health-degraded'}>
          {account?.funding?.ready?'READY':'NEEDS SETUP'}
        </span>
      </div>
      <div className="e2pay-topup-details">
        <div>
          <span>Bank tujuan</span>
          <strong>{account?.funding?.bankName||'Belum dikonfigurasi'}</strong>
          {account?.funding?.bankName?<button type="button" className="btn btn-compact" onClick={()=>void copyText('bank',account?.funding?.bankName)}>{copied==='bank'?'Tersalin':'Salin'}</button>:null}
        </div>
        <div>
          <span>Virtual Account (VA)</span>
          <strong className="e2pay-va-number">{account?.funding?.vaNumber||'Belum tersedia'}</strong>
          {account?.funding?.vaNumber?<button type="button" className="btn btn-compact" onClick={()=>void copyText('va',account?.funding?.vaNumber)}>{copied==='va'?'Tersalin':'Salin VA'}</button>:null}
        </div>
        <div>
          <span>Nama akun</span>
          <strong>{account?.funding?.accountName||account?.accountName||'—'}</strong>
        </div>
      </div>
      {!account?.funding?.bankName?<DismissibleBubble className="app-notice-bubble app-notice-error" role="alert">
        <strong>Bank tujuan VA belum dikonfigurasi</strong>
        <span>Jangan melakukan transfer sebelum Super Admin mengisi Funding bank di Settings → Payment Gateway berdasarkan informasi resmi E2Pay.</span>
      </DismissibleBubble>:null}
      {String(account?.environment||'').toUpperCase()==='UAT'?<DismissibleBubble className="app-notice-bubble app-notice-info" role="note">
        <strong>Permata 701075327 bukan VA Top Up</strong>
        <span>Data dummy Permata tersebut hanya untuk pengujian transaksi/disbursement pada E2Pay UAT. Jangan gunakan sebagai tujuan pengisian saldo wallet.</span>
      </DismissibleBubble>:null}
      <ol className="e2pay-topup-steps">
        <li>Buka mobile banking / internet banking perusahaan.</li>
        <li>Pilih transfer ke <strong>{account?.funding?.bankName||'bank VA E2Pay'}</strong>.</li>
        <li>Masukkan nomor VA di atas dan nominal yang akan ditambahkan ke wallet.</li>
        <li>Setelah transfer sukses, klik <strong>Refresh saldo</strong> untuk memastikan balance E2Pay sudah bertambah.</li>
      </ol>
      <div className="e2pay-topup-share">
        <span>Info siap ditempel ke WhatsApp, email, Slack, Notes, atau platform lain.</span>
        {fundingClipboardText?<pre>{fundingClipboardText}</pre>:null}
      </div>
      <div className="e2pay-topup-actions">
        <button
          type="button"
          className="btn btn-primary"
          disabled={loading||!account?.funding?.ready||!fundingClipboardText}
          onClick={()=>void copyText('funding-details',fundingClipboardText)}
        >
          {copied==='funding-details'?'Info Top Up tersalin':'Salin Info Top Up'}
        </button>
        <button type="button" className="btn" disabled={loading} onClick={()=>void loadOverview(true)}>{loading?'Refreshing…':'Refresh saldo'}</button>
      </div>
      <small className="e2pay-topup-note">Tombol utama menyalin Bank, VA, nama akun, environment, provider, dan waktu pengecekan dalam plain text. Tombol kecil “Salin VA” tetap tersedia jika hanya nomor VA yang dibutuhkan.</small>
    </section>:null}

    </div>
    {isUat?<div id="e2pay-panel-uat" role="tabpanel" aria-labelledby="e2pay-tab-uat" hidden={activeTab!=='uat'}>
    {String(account?.environment||'').toUpperCase()==='UAT' && uatValidation?<section className="integration-panel" aria-label="P5.4 UAT Disbursement Validation">
      <div className="integration-panel-head">
        <div><strong>P5.4 Transactional UAT</strong><small>Single-recipient canary lebih dulu, lalu recovery/reconciliation, baru batch 5 beneficiary.</small></div>
        <button type="button" className="btn btn-compact" onClick={()=>void loadUatValidation()}>Refresh UAT status</button>
      </div>
      {([['Canary',uatValidation.canary],['Batch',uatValidation.batch]] as Array<[string,E2PayUatLane|null]>).map(([label,row])=><article key={label} className="e2pay-uat-lane">
        <div><strong>{label}</strong><span>{row?.phase||'NOT_READY'}</span></div>
        <small>{row?(row.submission.recipientCount+' recipient · '+formatIDR(row.submission.expectedTotal)+' · '+row.submission.id):'Dataset belum tersedia'}</small>
        <b>{row?.masterAccount?('Master Account '+(row.masterAccount.status==='ACTIVE'?'aktif':'belum aktif')):'Master Account belum tersedia'}</b>
        <em>{row?('Saldo Master '+row.liquidity.state+' · PI '+(row.paymentInstruction?.status||'belum dibuat')+' · Gateway '+(row.transaction?.status||'belum ada')):'Menunggu dataset UAT'}</em>
      </article>)}
      <DismissibleBubble className="app-notice-bubble app-notice-info" role="note">
        <strong>Authority tetap Payment Control</strong>
        <span>Card ini hanya observability. Generate/submit PI dilakukan Processor, approval dan Process Payment hanya Payroll Controller. Raw disbursement dari Integration Console tetap dinonaktifkan.</span>
      </DismissibleBubble>
      <details className="e2pay-collapsible"><summary>Langkah pengujian UAT</summary><ol className="e2pay-topup-steps">
        <li>Pastikan saldo Master siap dan canary menunjukkan <b>READY_FOR_PI</b>.</li>
        <li>Processor membuat + submit PI canary Rp15.000.</li>
        <li>Controller review immutable routing lalu approve dan Process Payment.</li>
        <li>Uji idempotent replay; jangan membuat financial attempt kedua.</li>
        <li>Bila UNKNOWN/timeout, jalankan reconciliation sebelum retry.</li>
        <li>Setelah canary selesai dan reconciliation MATCHED, lanjut batch 5 beneficiary Rp175.000.</li>
      </ol></details>
    </section>:<div className="integration-empty">Status UAT belum tersedia untuk environment ini.</div>}
    </div>:null}
    <div id="e2pay-panel-activity" role="tabpanel" aria-labelledby="e2pay-tab-activity" hidden={activeTab!=='activity'}>
    <div className="integrations-two-col e2pay-operational-grid">
      <section className="integration-panel">
        <div className="integration-panel-head"><div><strong>Transaction history</strong><small>Riwayat transaksi provider</small></div><span>{transactionCount}</span></div>
        <div className="e2pay-filter-grid">
          <Field label="Client ref" value={txClientRef} onChange={setTxClientRef} placeholder="PQP-…" />
          <label><span>Response code</span><select value={txResponseCode} onChange={(e)=>setTxResponseCode(e.target.value)}><option value="">Semua</option><option value="00">00 Success</option><option value="96">96 On Process</option><option value="99">99 Failed</option></select></label>
          <Field label="From" type="date" value={txFrom} onChange={setTxFrom} />
          <Field label="Until" type="date" value={txUntil} onChange={setTxUntil} />
        </div>
        <button type="button" className="btn" disabled={actionLoading==='TRANSACTIONS'} onClick={()=>void loadTransactions()}>{actionLoading==='TRANSACTIONS'?'Loading…':'Load history'}</button>
        <div className="e2pay-resource-list">{transactions.map((row,index)=><article key={row.accountTransactionId||row.journalId||index}><div><strong>{row.transactionName||row.description||'Transaction'}</strong><span>{row.responseCode||'—'}</span></div><small>{row.clientRef||'No clientRef'} · {dateTime(row.transactionTimestamp)}</small><b>{formatIDR(Number(row.amount||0))}</b><em>{row.responseMessage||row.journalId||'—'}</em></article>)}{!transactions.length?<div className="integration-empty">{transactionsLoaded?'Tidak ada transaksi pada filter ini.':'Belum dimuat.'}</div>:null}</div>
        {transactionsLoaded?<nav className="e2pay-action-row" aria-label="Halaman riwayat transaksi">
          <button type="button" className="btn" disabled={Boolean(actionLoading)||transactionPage.offset===0}
            onClick={()=>void loadTransactions(Math.max(0,transactionPage.offset-50),true)}>Sebelumnya</button>
          <span>Halaman {Math.floor(transactionPage.offset/50)+1}</span>
          <button type="button" className="btn" disabled={Boolean(actionLoading)||!transactionPage.hasNext}
            onClick={()=>void loadTransactions(transactionPage.offset+50,true)}>Berikutnya</button>
        </nav>:null}
      </section>

      <section className="integration-panel">
        <div className="integration-panel-head"><div><strong>Bank directory</strong><small>Bank tujuan yang didukung E2Pay</small></div><span>{banksLoaded?banks.length:'—'}</span></div>
        <div className="e2pay-inline-search"><input value={bankSearch} onChange={(e)=>setBankSearch(e.target.value)} placeholder="Cari nama bank…" /><button type="button" className="btn" disabled={actionLoading==='BANKS'} onClick={()=>void loadBanks()}>{actionLoading==='BANKS'?'Loading…':'Load banks'}</button></div>
        <div className="e2pay-bank-list">{banks.slice(0,100).map((row)=><div key={row.id}><code>{row.id}</code><strong>{row.name}</strong><span>{String(row.active).toLowerCase()==='false'?'Inactive':'Active'}</span></div>)}{!banks.length?<div className="integration-empty">{banksLoaded?'Tidak ada bank yang cocok.':'Belum dimuat.'}</div>:null}</div>
      </section>
    </div>
    </div>

    <div id="e2pay-panel-technical" role="tabpanel" aria-labelledby="e2pay-tab-technical" hidden={activeTab!=='technical'}>
    <button type="button" className="e2pay-endpoint-link" aria-haspopup="dialog" onClick={()=>endpointDialog.current?.showModal()}>
      Daftar endpoint E2Pay ({catalog.length})
    </button>
    <dialog ref={endpointDialog} className="e2pay-endpoint-dialog" aria-labelledby="e2pay-endpoint-title">
      <div className="e2pay-endpoint-dialog-header">
        <h4 id="e2pay-endpoint-title">Daftar endpoint E2Pay</h4>
        <form method="dialog"><button type="submit" className="btn">Tutup</button></form>
      </div>
      <div className="e2pay-endpoint-summary">
        <span>{endpointCounts.get('LIVE_READ')||0} live read</span>
        <span>{endpointCounts.get('ADMIN_ACTION')||0} admin action</span>
        <span>{endpointCounts.get('SERVER_MANAGED')||0} server managed</span>
        <span>{endpointCounts.get('DIAGNOSTIC')||0} diagnostic</span>
      </div>
      <div className="e2pay-endpoint-table-wrap"><table className="e2pay-endpoint-table">
        <caption className="sr-only">Daftar endpoint E2Pay B2B API yang terintegrasi</caption>
        <thead><tr><th>Function</th><th>Method</th><th>Canonical path</th><th>Control</th></tr></thead>
        <tbody>{catalog.map((item)=><tr key={item.id}><td><strong>{item.function}</strong><small>{item.id}</small></td><td><code>{item.method}</code></td><td><code>{item.path}</code></td><td><span className={`e2pay-mode e2pay-mode-${item.mode.toLowerCase().replaceAll('_','-')}`}>{endpointMode(item.mode)}</span></td></tr>)}</tbody>
      </table></div>
    </dialog>

    {canManage?<details className="e2pay-collapsible e2pay-admin-console">
      <summary><span>Advanced administration</span><b>Super Admin</b></summary>
      <div className="e2pay-admin-body">
        <div className="e2pay-technical-intro">
          <h4>Pengujian teknis E2Pay</h4>
          <p>Pilih kategori untuk menjalankan tes langsung atau mengisi form skenario.</p>
        </div>
        <div className="e2pay-form-grid e2pay-technical-filters">
          <label><span>Kategori tes</span>
            <select value={technicalTab} onChange={(event)=>{setTechnicalTab(event.target.value);setScriptInput('');}}>
              {TECHNICAL_TABS.map(([key,label])=><option key={key} value={key}>{label}</option>)}
            </select>
          </label>
          {scriptCases.some(([id])=>!QUICK_TEST_LABELS[id])?<label><span>Skenario lainnya</span>
            <select value={scriptId && QUICK_TEST_LABELS[scriptId]?"":scriptId} onChange={(event)=>{setScriptIndex(Number(event.target.value));setScriptInput('');}}>
              <option value="" disabled>Pilih skenario</option>
              {scriptCases.filter(([id])=>!QUICK_TEST_LABELS[id]).map(([id,,name])=><option key={id} value={id}>{id}. {name}</option>)}
            </select>
          </label>:null}
        </div>
        {scriptCases.some(([id])=>QUICK_TEST_LABELS[id])?<section className="e2pay-quick-tests" aria-label="Tes tanpa input">
          <h5>Tes tanpa input</h5>
          <div className="e2pay-action-row">
            {scriptCases.filter(([id])=>QUICK_TEST_LABELS[id]).map(([id])=><button key={id} type="button"
              className={scriptId===id?'btn btn-primary':'btn'} disabled={Boolean(actionLoading)||account?.environment!=='UAT'}
              onClick={()=>{
                setScriptIndex(id);
                const key=`script-${id}`;
                if(id===19||id===20){
                  const filters=id===20?{limit:100}:{};
                  void run('TRANSACTIONS',{resource:'transactions',...filters},()=>getE2PayTransactions(filters),key);
                }else if(id===22){
                  void run('BANKS',{resource:'banks'},()=>getE2PayBanks(),key);
                }else{
                  const action=id===1?'HOST_AUTH_TEST':id===17?'REFRESH_ACCOUNT':id===9?'MERCHANT_AUTHORIZATION_TEST':'MERCHANT_OAUTH_TEST';
                  void run(action,{},undefined,key);
                }
              }}>{QUICK_TEST_LABELS[id]}</button>)}
          </div>
        </section>:null}
        <div className="e2pay-technical-layout">
          <div className="e2pay-technical-form">
        {selectedScript?<section className="e2pay-script-case">
          <h5>{selectedScript[0]}. {selectedScript[2]}</h5>
          <p>Expected Result</p>
          <pre className="e2pay-json-result">{selectedScript[3]}</pre>
          {[21,23].includes(scriptId||0)?<Field label={scriptId===21?'Client Ref uji':'Nama bank uji'} value={scriptInput} onChange={setScriptInput}/>:null}
          {scriptId===21||scriptId===23?<button type="button" className="btn btn-primary"
            disabled={Boolean(actionLoading)||account?.environment!=='UAT'||!scriptInput.trim()} onClick={()=>{
              if(scriptId===21){
                const filters={clientRef:scriptInput.trim()};
                void run('TRANSACTIONS',{resource:'transactions',...filters},()=>getE2PayTransactions(filters));
              }else{
                const filters={name:scriptInput.trim()};
                void run('BANKS',{resource:'banks',...filters},()=>getE2PayBanks(filters));
              }
            }}>Jalankan skenario</button>:null}
          {scriptId && scriptId>=29?<p>Validasi skenario pembayaran melalui Payment Control atau sandbox E2Pay yang terisolasi. Simpan hasil aktual di test script.</p>:null}
          {scriptId && [4,5,7,8,11,12,13,14,15,16,18,26,27].includes(scriptId)?<p>Jalankan pengujian negatif ini di sandbox E2Pay dengan data dan kredensial uji terpisah. Simpan respons aktual di test script.</p>:null}
        </section>:null}
        <section id="e2pay-test-diagnostics" hidden={technicalTab!=='diagnostics'}>
          <div className="e2pay-action-row">
            <button type="button" className="btn" disabled={Boolean(actionLoading)} onClick={()=>void run('REFRESH_ACCOUNT')}>Refresh account</button>
            <button type="button" className="btn" disabled={Boolean(actionLoading)} onClick={()=>void run('VERIFY_USERNAME')}>Verify username</button>
            <button type="button" className="btn" disabled={Boolean(actionLoading)} onClick={()=>void run('TOKEN_REFRESH_TEST')}>Test refresh token</button>
          </div>
        </section>

        <section id="e2pay-test-inquiry" hidden={technicalTab!=='inquiry' && ![24,25,28].includes(scriptId||0)}>
          <p>Validasi rekening tujuan dan fee tanpa mengirim uang.</p>
          {String(account?.environment||'').toUpperCase()==='UAT'?<DismissibleBubble className="app-notice-bubble app-notice-info" role="note">
            <strong>E2Pay UAT dummy destination</strong>
            <span>Sesuai arahan E2Pay untuk environment UAT: gunakan bank <b>Permata</b> dengan rekening dummy <b>701075327</b>. Nominal Rp15.000 berasal dari contoh dokumen dan dapat diubah sesuai skenario test.</span>
          </DismissibleBubble>:null}
          <div className="e2pay-form-grid">
            <Field label="Destination account" value={inquiry.accountId} onChange={(value)=>setInquiry({...inquiry,accountId:value})} />
            <Field label="Bank ID" value={inquiry.bankId} onChange={(value)=>setInquiry({...inquiry,bankId:value})} />
            <Field label="Amount" type="number" value={inquiry.amount} onChange={(value)=>setInquiry({...inquiry,amount:value})} />
          </div>
          <div className="e2pay-action-row">
            {String(account?.environment||'').toUpperCase()==='UAT'?<button type="button" className="btn" onClick={()=>setInquiry({...E2PAY_UAT_DUMMY})}>Gunakan dummy UAT</button>:null}
            <button type="button" className="btn" disabled={Boolean(actionLoading)} onClick={()=>void run('INQUIRY',{...inquiry,amount:Number(inquiry.amount)})}>Run inquiry</button>
          </div>
        </section>

        <section id="e2pay-test-registration" aria-label="Merchant registration request" hidden={scriptId!==2}>
          <div className="e2pay-form-grid">
            <Field label="Phone" value={registration.phone} onChange={(value)=>setRegistration({...registration,phone:value})} />
            <Field label="Name" value={registration.name} onChange={(value)=>setRegistration({...registration,name:value})} />
            <Field label="Email" type="email" value={registration.email} onChange={(value)=>setRegistration({...registration,email:value})} />
          </div>
          <div className="e2pay-form-grid">
            <Field label="Partner ID" placeholder="Gunakan konfigurasi UAT" value={registration.partnerId} onChange={(partnerId)=>setRegistration({...registration,partnerId})} />
            <Field label="Source ID" placeholder="Gunakan konfigurasi UAT" value={registration.sourceId} onChange={(sourceId)=>setRegistration({...registration,sourceId})} />
          </div>
          <button type="button" className="btn" disabled={Boolean(actionLoading)||account?.environment!=='UAT'||!registration.phone.trim()||!registration.name.trim()||!registration.email.trim()} onClick={()=>{
            const {phone,name,email,partnerId,sourceId}=registration;
            void run('REGISTER_REQUEST',{phone,name,email,partnerId:partnerId.trim(),sourceId:sourceId.trim()});
          }}>Registration request</button>
        </section>
        <section id="e2pay-test-registration-confirm" aria-label="Confirm merchant registration" hidden={scriptId!==3 && scriptId!==6}>
          <div className="e2pay-form-grid">
            <Field label="Username / phone" value={registration.username} onChange={(username)=>setRegistration({...registration,username})} />
            <Field label="Password" type="password" value={registration.password} onChange={(value)=>setRegistration({...registration,password:value})} />
            <Field label="Token / OTP" type="password" value={registration.token} onChange={(value)=>setRegistration({...registration,token:value})} />
          </div>
          <button type="button" className="btn" disabled={Boolean(actionLoading)||account?.environment!=='UAT'||!registration.username.trim()||!registration.password||!registration.token.trim()} onClick={()=>void run('REGISTER_CONFIRM',{username:registration.username,password:registration.password,token:registration.token})}>Complete registration</button>
        </section>

        <section id="e2pay-test-password" hidden={technicalTab!=='password'}>
          <div className="e2pay-form-grid">
            <Field label="Current password" type="password" value={password.password} onChange={(value)=>setPassword({...password,password:value})} />
            <Field label="New password" type="password" value={password.newPassword} onChange={(value)=>setPassword({...password,newPassword:value})} />
          </div>
          <button type="button" className="btn" disabled={Boolean(actionLoading)} onClick={()=>void run('CHANGE_PASSWORD',password)}>Change password</button>
          <hr />
          <div className="e2pay-form-grid">
            <Field label="Merchant email" value={reset.email} onChange={(value)=>setReset({...reset,email:value})} />
            <Field label="Account group ID" value={reset.accountGroupId} onChange={(value)=>setReset({...reset,accountGroupId:value})} />
            <Field label="Reset token" type="password" value={reset.token} onChange={(value)=>setReset({...reset,token:value})} />
            <Field label="New password" type="password" value={reset.newPassword} onChange={(value)=>setReset({...reset,newPassword:value})} />
          </div>
          <div className="e2pay-action-row">
            <button type="button" className="btn" disabled={Boolean(actionLoading)} onClick={()=>void run('RESET_PASSWORD_REQUEST',reset)}>Request reset token</button>
            <button type="button" className="btn" disabled={Boolean(actionLoading)} onClick={()=>void run('RESET_PASSWORD_CONFIRM',reset)}>Confirm reset</button>
          </div>
        </section>

        <section id="e2pay-test-phone" hidden={technicalTab!=='phone'}>
          <div className="e2pay-form-grid">
            <Field label="Current password" type="password" value={phone.password} onChange={(value)=>setPhone({...phone,password:value})} />
            <Field label="New phone" value={phone.phone} onChange={(value)=>setPhone({...phone,phone:value})} />
            <Field label="SMS token" type="password" value={phone.token} onChange={(value)=>setPhone({...phone,token:value})} />
          </div>
          <div className="e2pay-action-row">
            <button type="button" className="btn" disabled={Boolean(actionLoading)} onClick={()=>void run('CHANGE_PHONE_REQUEST',phone)}>Request phone change</button>
            <button type="button" className="btn" disabled={Boolean(actionLoading)} onClick={()=>void run('CHANGE_PHONE_CONFIRM',{phone:phone.phone,token:phone.token})}>Confirm phone change</button>
          </div>
        </section>

          </div>
          <aside className="e2pay-technical-output" aria-label="Bukti uji E2Pay">
            {(['request','response'] as const).map((kind)=>{
              const title=kind==='request'?'Request':'Response';
              const value=technicalOutput?.[kind]||'';
              return <section key={kind}>
                <div className="e2pay-technical-output-heading">
                  <label htmlFor={`e2pay-technical-${kind}`}>{title}</label>
                  <button type="button" className="btn" disabled={!value} onClick={()=>void navigator.clipboard.writeText(value)}>Salin {title}</button>
                </div>
                <textarea id={`e2pay-technical-${kind}`} className="input e2pay-json-result" readOnly rows={8} value={value}
                  placeholder={kind==='request'?'Request ProQPay tampil setelah tes dijalankan.':'Hasil tes tampil di sini.'} />
              </section>;
            })}
          </aside>
        </div>
      </div>
    </details>:null}

    <div className="e2pay-governance-note">Disbursement tetap dijalankan melalui approved Payment Instruction di Payment Control.</div>
    </div>
  </section>;
}

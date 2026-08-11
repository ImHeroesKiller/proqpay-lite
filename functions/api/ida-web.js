/**
 * IDA web knowledge lookup
 * Provider order: DuckDuckGo REST -> Tavily fallback.
 * Results are treated as untrusted references and capped before prompt injection.
 */

const OFFICIAL_CONFIDENCE = 0.92;
const GENERAL_CONFIDENCE = 0.68;
const MAX_RESULTS = 5;
const ALLOWED_HOSTS = [
  'pajak.go.id','kemenkeu.go.id','bpjsketenagakerjaan.go.id','bpjs-kesehatan.go.id',
  'kemnaker.go.id','bps.go.id','peraturan.bpk.go.id','jdih.kemenkeu.go.id',
  'jdih.kemnaker.go.id','djponline.pajak.go.id','indonesia.go.id',
];

const REGULATORY_TRIGGERS = [
  { id:'pph21', test:/\b(pph\s*21|pph21|tarif\s*pajak|ter\s*pph|ptkp)\b/i, query:'tarif PPh 21 TER terbaru', label:'PPh 21 / tarif pajak' },
  { id:'bpjs_tk', test:/\b(bpjs\s*tk|bpjs\s*ketenagakerjaan|iuran\s*jht|jkk|jkm|jaminan\s*hari\s*tua)\b/i, query:'iuran BPJS Ketenagakerjaan terbaru', label:'BPJS Ketenagakerjaan' },
  { id:'bpjs_kes', test:/\b(bpjs\s*kesehatan|iuran\s*jkn|bpjs\s*kes)\b/i, query:'iuran BPJS Kesehatan terbaru', label:'BPJS Kesehatan' },
  { id:'umk', test:/\b(umr|umk|upah\s*minimum|ump\b)\b/i, query:'UMK UMP terbaru Indonesia', label:'UMR/UMK' },
  { id:'payroll_rule', test:/\b(peraturan\s*menteri|pp\s*\d+|permenaker|ketentuan\s*baru\s*payroll|regulasi\s*payroll)\b/i, query:'peraturan ketenagakerjaan pengupahan terbaru', label:'Peraturan pengupahan' },
];

function clean(value, max=700) {
  return String(value || '').replace(/<[^>]*>/g,' ').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,max);
}

function validHttpUrl(value) {
  try { return ['http:','https:'].includes(new URL(value).protocol); } catch { return false; }
}

function hostAllowed(url) {
  try {
    const host=new URL(url).hostname.replace(/^www\./,'');
    return ALLOWED_HOSTS.some((domain)=>host===domain || host.endsWith('.'+domain));
  } catch { return false; }
}

function requestPlan(userText) {
  const regulatory=REGULATORY_TRIGGERS.filter((item)=>item.test.test(userText)).slice(0,2);
  if (regulatory.length) return regulatory.map((item)=>({ ...item, official:true }));
  const explicit=/\b(cari|search|telusuri|cek|periksa|lihat)\b.{0,50}\b(internet|web|online|website|berita|sumber)\b/i.test(userText);
  const current=/\b(terbaru|terkini|hari ini|saat ini|update terbaru|latest)\b/i.test(userText);
  if (!explicit && !current) return [];
  return [{ id:'web_search',label:'Pencarian internet',query:clean(userText,300),official:false }];
}

async function searchDuckDuckGo(query) {
  const endpoint='https://api.duckduckgo.com/?format=json&no_html=1&no_redirect=1&skip_disambig=1&q='+encodeURIComponent(query);
  const response=await fetch(endpoint,{headers:{Accept:'application/json','User-Agent':'ProQPayIDA/1.0'},signal:AbortSignal.timeout(6500)});
  if(!response.ok) throw new Error(`DDG HTTP ${response.status}`);
  const data=await response.json();
  const items=[];
  if(data.AbstractText && data.AbstractURL) items.push({title:data.Heading||'DuckDuckGo',url:data.AbstractURL,snippet:data.AbstractText,score:.8});
  for(const item of Array.isArray(data.Results)?data.Results:[]) if(item.Text&&item.FirstURL) items.push({title:item.Text.slice(0,100),url:item.FirstURL,snippet:item.Text,score:.75});
  for(const group of Array.isArray(data.RelatedTopics)?data.RelatedTopics:[]) {
    const nested=Array.isArray(group.Topics)?group.Topics:[group];
    for(const item of nested) if(item.Text&&item.FirstURL) items.push({title:item.Text.slice(0,100),url:item.FirstURL,snippet:item.Text,score:.7});
  }
  return items;
}

async function searchTavily(query,apiKey,official) {
  if(!apiKey) return [];
  const payload={api_key:apiKey,query,search_depth:'basic',max_results:MAX_RESULTS,include_answer:false,include_raw_content:false};
  if(official) payload.include_domains=ALLOWED_HOSTS;
  const response=await fetch('https://api.tavily.com/search',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(8500)});
  if(!response.ok) throw new Error(`Tavily HTTP ${response.status}`);
  const data=await response.json();
  return (Array.isArray(data.results)?data.results:[]).map((item)=>({title:item.title,url:item.url,snippet:item.content,score:Number(item.score||.72)}));
}

function accept(items,plan,provider) {
  return items
    .filter((item)=>validHttpUrl(item.url) && clean(item.snippet,700))
    .map((item)=>{
      const official=hostAllowed(item.url);
      const confidence=plan.official ? (official ? Math.max(OFFICIAL_CONFIDENCE,Number(item.score||0)) : 0) : Math.max(GENERAL_CONFIDENCE,Number(item.score||0));
      return {topic:plan.id,label:plan.label,title:clean(item.title,140),url:item.url,snippet:clean(item.snippet,700),confidence:Number(Math.min(1,confidence).toFixed(3)),provider};
    })
    .filter((item)=>item.confidence >= (plan.official?OFFICIAL_CONFIDENCE:GENERAL_CONFIDENCE));
}

export async function fetchRegulatoryWeb(userText,env={}) {
  const plans=requestPlan(userText);
  if(!plans.length) return {used:false,triggers:[],snippets:[],provider:null};
  const collected=[];
  const providers=[];

  for(const plan of plans) {
    const query=plan.official ? `${plan.query} ${ALLOWED_HOSTS.slice(0,6).map((domain)=>'site:'+domain).join(' OR ')}` : plan.query;
    let accepted=[];
    try {
      accepted=accept(await searchDuckDuckGo(query),plan,'duckduckgo');
      if(accepted.length) providers.push('duckduckgo');
    } catch {}
    if(!accepted.length && env.TAVILY_API_KEY) {
      try {
        accepted=accept(await searchTavily(plan.query,env.TAVILY_API_KEY,plan.official),plan,'tavily');
        if(accepted.length) providers.push('tavily');
      } catch {}
    }
    collected.push(...accepted);
  }

  const unique=[...new Map(collected.map((item)=>[item.url,item])).values()]
    .sort((a,b)=>b.confidence-a.confidence)
    .slice(0,MAX_RESULTS);
  return {
    used:unique.length>0,
    triggers:plans.map((item)=>item.id),
    snippets:unique,
    provider:[...new Set(providers)].join('->')||null,
    fallbackAvailable:Boolean(env.TAVILY_API_KEY),
  };
}

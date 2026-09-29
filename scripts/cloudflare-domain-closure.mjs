import fs from 'node:fs';
import dns from 'node:dns/promises';

const token=String(process.env.CLOUDFLARE_API_TOKEN || '');
const accountId=String(process.env.CLOUDFLARE_ACCOUNT_ID || '');
const project=String(process.env.PAGES_PROJECT_NAME || 'proqpay-lite');
const domain=String(process.env.PROQPAY_CUSTOM_DOMAIN || 'proqpay.msg-os.com').toLowerCase();
const zoneName=String(process.env.CLOUDFLARE_ZONE_NAME || 'msg-os.com').toLowerCase();
const evidencePath=String(process.env.EDGE_DOMAIN_EVIDENCE_PATH || '/tmp/proqpay-edge-domain-closure.json');

if(!token || !accountId) throw new Error('Cloudflare credentials are required');
if(!domain.endsWith('.'+zoneName) && domain!==zoneName) throw new Error('Custom domain must belong to configured Cloudflare zone');

const evidence={
  generatedAt:new Date().toISOString(),
  project,
  domain,
  zoneName,
  pages:{},
  dns:{},
  closed:false,
};

function persist(){
  fs.writeFileSync(evidencePath,JSON.stringify(evidence,null,2)+'\n');
}

async function api(path,{method='GET',body}={}){
  const response=await fetch('https://api.cloudflare.com/client/v4'+path,{
    method,
    headers:{
      Authorization:`Bearer ${token}`,
      'Content-Type':'application/json',
    },
    body:body===undefined?undefined:JSON.stringify(body),
  });
  const data=await response.json().catch(()=>({success:false,errors:[{message:'Invalid JSON response'}]}));
  if(!response.ok || data.success===false){
    const message=(data.errors||[]).map((item)=>item.message||item.code).join('; ') || `HTTP ${response.status}`;
    throw new Error(`Cloudflare API ${method} ${path} failed: ${message}`);
  }
  return data;
}

const zones=await api(`/zones?name=${encodeURIComponent(zoneName)}&account.id=${encodeURIComponent(accountId)}`);
const zone=(zones.result||[]).find((row)=>String(row.name).toLowerCase()===zoneName);
if(!zone?.id) throw new Error(`Cloudflare zone not found: ${zoneName}`);
evidence.zone={id:zone.id,name:zone.name,status:zone.status,plan:zone.plan?.name||null};

const domainList=await api(`/accounts/${accountId}/pages/projects/${project}/domains`);
let pageDomain=(domainList.result||[]).find((row)=>String(row.name).toLowerCase()===domain);
if(!pageDomain){
  const created=await api(`/accounts/${accountId}/pages/projects/${project}/domains`,{
    method:'POST',
    body:{name:domain},
  });
  pageDomain=created.result;
  evidence.pages.created=true;
}else{
  evidence.pages.created=false;
}

const expectedTarget=`${project}.pages.dev`;
try{
  const dnsList=await api(`/zones/${zone.id}/dns_records?name=${encodeURIComponent(domain)}`);
  let dnsRecord=(dnsList.result||[]).find((row)=>String(row.name).toLowerCase()===domain);
  if(!dnsRecord){
    const created=await api(`/zones/${zone.id}/dns_records`,{
      method:'POST',
      body:{type:'CNAME',name:domain,content:expectedTarget,ttl:1,proxied:true},
    });
    dnsRecord=created.result;
    evidence.dns.created=true;
  }else{
    evidence.dns.created=false;
    if(String(dnsRecord.type).toUpperCase()!=='CNAME' || String(dnsRecord.content).toLowerCase()!==expectedTarget){
      throw new Error(`Existing DNS record for ${domain} is not expected CNAME to ${expectedTarget}; refusing destructive overwrite`);
    }
    if(!dnsRecord.proxied){
      const updated=await api(`/zones/${zone.id}/dns_records/${dnsRecord.id}`,{
        method:'PATCH',
        body:{proxied:true},
      });
      dnsRecord=updated.result;
      evidence.dns.proxiedUpdated=true;
    }
  }
  evidence.dns.mode='cloudflare-api';
  evidence.dns.record={
    id:dnsRecord.id,
    type:dnsRecord.type,
    name:dnsRecord.name,
    content:dnsRecord.content,
    proxied:Boolean(dnsRecord.proxied),
  };
}catch(error){
  evidence.dns.apiError=error instanceof Error ? error.message : String(error);
  const [ipv4,ipv6]=await Promise.all([
    dns.resolve4(domain).catch(()=>[]),
    dns.resolve6(domain).catch(()=>[]),
  ]);
  const response=await fetch(`https://${domain}/api/health`,{
    redirect:'manual',
    headers:{'User-Agent':'ProQPay-P2.1-Domain-Evidence/1.0'},
  });
  const cfRay=String(response.headers.get('cf-ray')||'');
  const server=String(response.headers.get('server')||'').toLowerCase();
  const proxied=Boolean(cfRay) && server.includes('cloudflare') && (ipv4.length+ipv6.length)>0;
  if(!response.ok || !proxied){
    persist();
    throw new Error(`DNS API unavailable and public Cloudflare proxy evidence failed: ${evidence.dns.apiError}`);
  }
  evidence.dns.mode='public-cloudflare-proxy-evidence';
  evidence.dns.record={
    name:domain,
    expectedPagesTarget:expectedTarget,
    resolvedIpv4Count:ipv4.length,
    resolvedIpv6Count:ipv6.length,
    server,
    cfRayPresent:Boolean(cfRay),
    proxied:true,
  };
}
persist();

for(let attempt=1;attempt<=30;attempt+=1){
  const current=await api(`/accounts/${accountId}/pages/projects/${project}/domains/${encodeURIComponent(domain)}`);
  pageDomain=current.result;
  evidence.pages.status=pageDomain.status||null;
  persist();
  if(String(pageDomain.status||'').toLowerCase()==='active') break;
  if(attempt===30) throw new Error(`Pages custom domain did not become active: ${pageDomain.status||'unknown'}`);
  await new Promise((resolve)=>setTimeout(resolve,10_000));
}

evidence.pages.domain={
  id:pageDomain.id,
  name:pageDomain.name,
  status:pageDomain.status,
  createdOn:pageDomain.created_on||null,
};
evidence.closed=true;
persist();

console.log(JSON.stringify({
  domain:evidence.domain,
  pagesStatus:evidence.pages.domain.status,
  dnsEvidenceMode:evidence.dns.mode,
  dnsProxied:evidence.dns.record.proxied,
  customDomainClosed:true,
},null,2));

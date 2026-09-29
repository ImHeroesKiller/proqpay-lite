import fs from 'node:fs';
import dns from 'node:dns/promises';

const token=String(process.env.CLOUDFLARE_API_TOKEN || '');
const accountId=String(process.env.CLOUDFLARE_ACCOUNT_ID || '');
const project=String(process.env.PAGES_PROJECT_NAME || 'proqpay-lite');
const domain=String(process.env.PROQPAY_CUSTOM_DOMAIN || 'proqpay.msg-os.com').toLowerCase();
const zoneName=String(process.env.CLOUDFLARE_ZONE_NAME || 'msg-os.com').toLowerCase();
const evidencePath=String(process.env.EDGE_EVIDENCE_PATH || '/tmp/proqpay-edge-closure.json');

if(!token || !accountId) throw new Error('Cloudflare credentials are required');
if(!domain.endsWith('.'+zoneName) && domain!==zoneName) throw new Error('Custom domain must belong to configured Cloudflare zone');

const evidence={
  generatedAt:new Date().toISOString(),
  accountId,
  project,
  domain,
  zoneName,
  pages:{},
  dns:{},
  waf:{},
};

function persist(){
  fs.writeFileSync(evidencePath,JSON.stringify(evidence,null,2)+'\n');
}

async function api(path,{method='GET',body,allow404=false}={}){
  const response=await fetch('https://api.cloudflare.com/client/v4'+path,{
    method,
    headers:{
      Authorization:`Bearer ${token}`,
      'Content-Type':'application/json',
    },
    body:body===undefined?undefined:JSON.stringify(body),
  });
  const data=await response.json().catch(()=>({success:false,errors:[{message:'Invalid JSON response'}]}));
  if(allow404 && response.status===404) return {response,data};
  if(!response.ok || data.success===false){
    const message=(data.errors||[]).map((item)=>item.message||item.code).join('; ') || `HTTP ${response.status}`;
    throw new Error(`Cloudflare API ${method} ${path} failed: ${message}`);
  }
  return {response,data};
}

const zones=await api(`/zones?name=${encodeURIComponent(zoneName)}&account.id=${encodeURIComponent(accountId)}`);
const zone=(zones.data.result||[]).find((row)=>String(row.name).toLowerCase()===zoneName);
if(!zone?.id) throw new Error(`Cloudflare zone not found: ${zoneName}`);
evidence.zone={id:zone.id,name:zone.name,status:zone.status,plan:zone.plan?.name||null};

const domainList=await api(`/accounts/${accountId}/pages/projects/${project}/domains`);
let pageDomain=(domainList.data.result||[]).find((row)=>String(row.name).toLowerCase()===domain);
if(!pageDomain){
  const created=await api(`/accounts/${accountId}/pages/projects/${project}/domains`,{
    method:'POST',
    body:{name:domain},
  });
  pageDomain=created.data.result;
  evidence.pages.created=true;
}else{
  evidence.pages.created=false;
}

const expectedTarget=`${project}.pages.dev`;
let dnsRecord=null;
try{
  const dnsList=await api(`/zones/${zone.id}/dns_records?name=${encodeURIComponent(domain)}`);
  dnsRecord=(dnsList.data.result||[]).find((row)=>String(row.name).toLowerCase()===domain);
  if(!dnsRecord){
    const created=await api(`/zones/${zone.id}/dns_records`,{
      method:'POST',
      body:{type:'CNAME',name:domain,content:expectedTarget,ttl:1,proxied:true},
    });
    dnsRecord=created.data.result;
    evidence.dns.created=true;
  }else{
    evidence.dns.created=false;
    if(String(dnsRecord.type).toUpperCase()!=='CNAME' || String(dnsRecord.content).toLowerCase()!==expectedTarget){
      throw new Error(`Existing DNS record for ${domain} is not the expected CNAME to ${expectedTarget}; refusing destructive overwrite`);
    }
    if(!dnsRecord.proxied){
      const updated=await api(`/zones/${zone.id}/dns_records/${dnsRecord.id}`,{
        method:'PATCH',
        body:{proxied:true},
      });
      dnsRecord=updated.data.result;
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
    headers:{'User-Agent':'ProQPay-P2.1-Edge-Evidence/1.0'},
  });
  const cfRay=String(response.headers.get('cf-ray')||'');
  const server=String(response.headers.get('server')||'').toLowerCase();
  const proxied=Boolean(cfRay) && server.includes('cloudflare') && (ipv4.length+ipv6.length)>0;
  if(!response.ok || !proxied){
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

const zoneRulesets=await api(`/zones/${zone.id}/rulesets`);
const managed=(zoneRulesets.data.result||[]).filter((row)=>
  row.kind==='managed' && row.phase==='http_request_firewall_managed'
);
const fullManaged=managed.find((row)=>String(row.name).toLowerCase()==='cloudflare managed ruleset');
const freeManaged=managed.find((row)=>String(row.name).toLowerCase().includes('free managed ruleset'));
const freePlan=String(zone.plan?.name || '').toLowerCase().includes('free');
const preferred=freePlan ? freeManaged : (fullManaged || freeManaged);
if(!preferred){
  evidence.waf.availableManagedRulesets=managed.map((row)=>({id:row.id,name:row.name}));
  persist();
  throw new Error('No compatible Cloudflare managed WAF ruleset is visible for this zone/plan');
}
evidence.waf.catalogSource='zone-rulesets-api';
evidence.waf.selected={id:preferred.id,name:preferred.name,phase:preferred.phase};
persist();
let entry=await api(`/zones/${zone.id}/rulesets/phases/http_request_firewall_managed/entrypoint`,{allow404:true});
if(entry.response.status===404){
  const created=await api(`/zones/${zone.id}/rulesets`,{
    method:'POST',
    body:{
      name:'ProQPay Managed WAF entry point',
      description:'P2.1 managed WAF protection for ProQPay custom domain',
      kind:'zone',
      phase:'http_request_firewall_managed',
      rules:[{
        action:'execute',
        action_parameters:{id:preferred.id},
        expression:`(http.host eq "${domain}")`,
        description:`ProQPay: execute ${preferred.name}`,
        enabled:true,
      }],
    },
  });
  entry={response:{status:200},data:created.data};
  evidence.waf.createdEntryPoint=true;
}else{
  evidence.waf.createdEntryPoint=false;
}

let entryResult=entry.data.result;
const activeRules=Array.isArray(entryResult?.rules)?entryResult.rules:[];
let executeRule=activeRules.find((row)=>
  row.action==='execute'
  && row.enabled!==false
  && String(row.action_parameters?.id||'')===String(preferred.id)
  && (
    String(row.expression||'').trim()==='true'
    || String(row.expression||'').includes(domain)
  )
);
if(!executeRule){
  const created=await api(`/zones/${zone.id}/rulesets/${entryResult.id}/rules`,{
    method:'POST',
    body:{
      action:'execute',
      action_parameters:{id:preferred.id},
      expression:`(http.host eq "${domain}")`,
      description:`ProQPay: execute ${preferred.name}`,
      enabled:true,
    },
  });
  entryResult=created.data.result;
  executeRule=(entryResult.rules||[]).find((row)=>
    row.action==='execute'
    && row.enabled!==false
    && String(row.action_parameters?.id||'')===String(preferred.id)
    && (
      String(row.expression||'').trim()==='true'
      || String(row.expression||'').includes(domain)
    )
  );
  evidence.waf.createdExecuteRule=true;
}else{
  evidence.waf.createdExecuteRule=false;
}
if(!executeRule) throw new Error('Managed WAF execute rule could not be verified');

evidence.waf.ruleset={
  name:preferred.name,
  id:preferred.id,
  phase:preferred.phase,
  entrypointId:entryResult.id,
  executeRuleId:executeRule.id,
  expression:executeRule.expression,
  enabled:executeRule.enabled!==false,
};

for(let attempt=1;attempt<=30;attempt+=1){
  const current=await api(`/accounts/${accountId}/pages/projects/${project}/domains/${encodeURIComponent(domain)}`);
  pageDomain=current.data.result;
  evidence.pages.status=pageDomain.status||null;
  evidence.pages.verificationData=pageDomain.verification_data||null;
  evidence.pages.validationData=pageDomain.validation_data||null;
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
  zonePlan:evidence.zone.plan,
  pagesStatus:evidence.pages.domain.status,
  dnsEvidenceMode:evidence.dns.mode,
  dnsProxied:evidence.dns.record.proxied,
  wafRuleset:evidence.waf.ruleset.name,
  wafEnabled:evidence.waf.ruleset.enabled,
},null,2));

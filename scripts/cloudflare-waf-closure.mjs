import fs from 'node:fs';

const token=String(process.env.CLOUDFLARE_WAF_API_TOKEN || process.env.CLOUDFLARE_API_TOKEN || '');
const accountId=String(process.env.CLOUDFLARE_ACCOUNT_ID || '');
const domain=String(process.env.PROQPAY_CUSTOM_DOMAIN || 'proqpay.msg-os.com').toLowerCase();
const zoneName=String(process.env.CLOUDFLARE_ZONE_NAME || 'msg-os.com').toLowerCase();
const evidencePath=String(process.env.WAF_EVIDENCE_PATH || '/tmp/proqpay-waf-closure.json');

if(!token || !accountId) throw new Error('Cloudflare WAF token and account ID are required');

const evidence={
  generatedAt:new Date().toISOString(),
  domain,
  zoneName,
  waf:{status:'VERIFYING'},
  closed:false,
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
    if(response.status===401 || response.status===403 || /authentication|permission/i.test(message)){
      evidence.waf.status='TOKEN_PERMISSION_REQUIRED';
      evidence.waf.requiredPermissions=['Zone Read','Zone WAF Read','Zone WAF Edit'];
      evidence.waf.error=`Cloudflare API ${method} ${path} failed: ${message}`;
      persist();
      throw new Error('Cloudflare WAF evidence requires a token scoped to msg-os.com with Zone Read + Zone WAF Read + Zone WAF Edit');
    }
    throw new Error(`Cloudflare API ${method} ${path} failed: ${message}`);
  }
  return {response,data};
}

const zones=await api(`/zones?name=${encodeURIComponent(zoneName)}&account.id=${encodeURIComponent(accountId)}`);
const zone=(zones.data.result||[]).find((row)=>String(row.name).toLowerCase()===zoneName);
if(!zone?.id) throw new Error(`Cloudflare zone not found: ${zoneName}`);
evidence.zone={id:zone.id,name:zone.name,status:zone.status,plan:zone.plan?.name||null};

const zoneRulesets=await api(`/zones/${zone.id}/rulesets`);
const managed=(zoneRulesets.data.result||[]).filter((row)=>
  row.kind==='managed' && row.phase==='http_request_firewall_managed'
);
const fullManaged=managed.find((row)=>String(row.name).toLowerCase()==='cloudflare managed ruleset');
const freeManaged=managed.find((row)=>String(row.name).toLowerCase().includes('free managed ruleset'));
const freePlan=String(zone.plan?.name || '').toLowerCase().includes('free');
const preferred=freePlan ? freeManaged : (fullManaged || freeManaged);

evidence.waf.availableManagedRulesets=managed.map((row)=>({id:row.id,name:row.name,phase:row.phase}));
if(!preferred){
  evidence.waf.status='NO_COMPATIBLE_MANAGED_RULESET';
  persist();
  throw new Error('No compatible Cloudflare managed WAF ruleset is visible for this zone/plan');
}

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

if(!executeRule){
  evidence.waf.status='EXECUTE_RULE_NOT_VERIFIED';
  persist();
  throw new Error('Managed WAF execute rule could not be verified');
}

evidence.waf.status='ACTIVE';
evidence.waf.ruleset={
  name:preferred.name,
  id:preferred.id,
  phase:preferred.phase,
  entrypointId:entryResult.id,
  executeRuleId:executeRule.id,
  expression:executeRule.expression,
  enabled:executeRule.enabled!==false,
};
evidence.closed=true;
persist();

console.log(JSON.stringify({
  domain,
  zonePlan:evidence.zone.plan,
  wafRuleset:evidence.waf.ruleset.name,
  wafEnabled:evidence.waf.ruleset.enabled,
  wafClosed:true,
},null,2));

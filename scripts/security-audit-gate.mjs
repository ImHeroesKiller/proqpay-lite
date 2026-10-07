import { readFile } from 'node:fs/promises';

const [auditPath='/tmp/npm-audit.json', lockPath='package-lock.json'] = process.argv.slice(2);
const [auditRaw,lockRaw]=await Promise.all([readFile(auditPath,'utf8'),readFile(lockPath,'utf8')]);
const report=JSON.parse(auditRaw);
const lock=JSON.parse(lockRaw);
const vulnerabilities=report.vulnerabilities||{};
const packages=lock.packages||{};

const temporaryDevOnlyAdvisories=new Set([
  'https://github.com/advisories/ghsa-vfj7-8cjw-p6xm',
  // Cloudflare local tooling only: Wrangler -> Miniflare -> Sharp.
  // Keep this exception dev-only; runtime/production packages are never accepted.
  // Remove once the locked Wrangler/Miniflare chain consumes sharp >=0.35.5.
  'https://github.com/advisories/ghsa-wq5f-xc86-pv6w',
]);

const severityRank={low:1,moderate:2,high:3,critical:4};

function advisoryUrls(name,seen=new Set()){
  if(seen.has(name)) return new Set();
  seen.add(name);
  const item=vulnerabilities[name];
  const urls=new Set();
  for(const via of item?.via||[]){
    if(typeof via==='string'){
      for(const url of advisoryUrls(via,seen)) urls.add(url);
    }else if(via?.url){
      urls.add(String(via.url).toLowerCase());
    }
  }
  return urls;
}

function nodesAreDevOnly(item){
  const nodes=Array.isArray(item?.nodes)?item.nodes:[];
  return nodes.length>0 && nodes.every((node)=>packages[node]?.dev===true);
}

function isTemporaryDevOnlyException(name,item){
  const urls=[...advisoryUrls(name)];
  return nodesAreDevOnly(item)
    && urls.length>0
    && urls.every((url)=>temporaryDevOnlyAdvisories.has(url));
}

const blockers=[];
const accepted=[];
for(const [name,item] of Object.entries(vulnerabilities)){
  if((severityRank[String(item?.severity||'').toLowerCase()]||0)<severityRank.high) continue;
  if(isTemporaryDevOnlyException(name,item)) accepted.push(name);
  else blockers.push({name,severity:item?.severity||'unknown',via:[...advisoryUrls(name)]});
}

if(accepted.length){
  console.warn('Temporarily accepted dev-only advisory chain:',accepted.join(', '));
  console.warn('Accepted advisories are restricted to dev-only dependency nodes; runtime High/Critical findings still block CI.');
}
if(blockers.length){
  console.error('Blocking High/Critical dependency vulnerabilities remain:');
  for(const item of blockers) console.error('-',item.name,item.severity,item.via.join(', '));
  process.exit(1);
}
console.log('Security dependency gate passed: no unaccepted High/Critical vulnerabilities.');

import fs from 'node:fs';

const [reportPath,evidencePath] = process.argv.slice(2);
if(!reportPath || !evidencePath){
  throw new Error('Usage: node security-zap-gate.mjs <zap.json> <evidence.json>');
}

const report=JSON.parse(fs.readFileSync(reportPath,'utf8'));
const alerts=[];

function visit(value){
  if(!value || typeof value!=='object') return;
  if(Array.isArray(value)){
    for(const item of value) visit(item);
    return;
  }
  if(Object.prototype.hasOwnProperty.call(value,'riskcode') || Object.prototype.hasOwnProperty.call(value,'riskdesc')){
    const riskCode=Number(value.riskcode ?? String(value.riskdesc||'').match(/^\d+/)?.[0] ?? 0);
    alerts.push({
      name:String(value.name || value.alert || value.pluginid || 'ZAP finding').slice(0,240),
      riskCode:Number.isFinite(riskCode)?riskCode:0,
      riskDesc:String(value.riskdesc || '').slice(0,120),
      confidence:String(value.confidence || value.confidencedesc || '').slice(0,80),
      count:Array.isArray(value.instances)?value.instances.length:1,
    });
  }
  for(const nested of Object.values(value)) visit(nested);
}
visit(report);

const unique=new Map();
for(const alert of alerts){
  const key=`${alert.name}::${alert.riskCode}`;
  const previous=unique.get(key);
  unique.set(key,previous ? {...alert,count:previous.count+alert.count} : alert);
}
const findings=[...unique.values()].sort((a,b)=>b.riskCode-a.riskCode || a.name.localeCompare(b.name));
const high=findings.filter((item)=>item.riskCode>=3);
const medium=findings.filter((item)=>item.riskCode===2);
const evidence={
  generatedAt:new Date().toISOString(),
  scanner:'OWASP ZAP Baseline',
  policy:'Passive baseline; fail on High/Critical risk findings',
  counts:{
    total:findings.length,
    highOrCritical:high.length,
    medium:medium.length,
  },
  highOrCritical:high,
  medium,
  passed:high.length===0,
};
fs.writeFileSync(evidencePath,JSON.stringify(evidence,null,2)+'\n');
console.log(JSON.stringify(evidence,null,2));
if(high.length) process.exit(2);

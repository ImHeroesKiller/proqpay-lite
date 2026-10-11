import { d1All, d1Batch, d1First, hasD1 } from './_d1.js';
import { authorize, enforceRateLimit, handlePreflight, secureJson } from './_security.js';
import { roleHasCapability } from '../../shared/authority-matrix.js';
import { canonicalProviderChannelConfig, providerChannelConfigHash, providerChannelSnapshot } from './provider-channel-router.js';

const METHODS='GET, POST, OPTIONS';
function clean(value,limit=180){ return String(value??'').trim().replace(/[\r\n\t]+/g,' ').slice(0,limit); }
function orgId(env,actor){ return String(actor?.orgId||env.DEFAULT_ORG_ID||'ORG-OTSINDO'); }
function audit(org,actor,action,detail,id){ return {statement:`INSERT INTO audit_logs(id,org_id,username,role,action,detail,entity,entity_id) VALUES(?,?,?,?,?,?, 'provider_channel_mapping',?)`,bindings:[`AUD-${crypto.randomUUID()}`,org,actor.email||actor.name||'system',actor.role,action,clean(detail,1000),id]}; }
function publicMapping(row){
  if(!row) return null;
  return {
    id:row.id,provider:row.provider,environment:row.environment,purpose:row.purpose,destinationMode:row.destination_mode,
    beneficiaryType:row.beneficiary_type,providerChannel:row.provider_channel||null,status:row.mapping_status,
    contractVersion:row.contract_version||'1',effectiveFrom:row.effective_from||null,effectiveUntil:row.effective_until||null,
    configHash:row.config_hash||null,confirmedBy:row.confirmed_by||null,confirmedAt:row.confirmed_at||null,
    confirmationReference:row.confirmation_reference||null,snapshot:providerChannelSnapshot(row),updatedAt:row.updated_at,
  };
}

export async function onRequest({request,env}){
  if(request.method==='OPTIONS') return handlePreflight(request,env,METHODS);
  if(!['GET','POST'].includes(request.method)) return secureJson({error:'Method not allowed'},405,request,env,METHODS);
  const authorization=await authorize(request,env,{mutating:request.method==='POST',methods:METHODS});
  if(authorization.response) return authorization.response;
  const limited=await enforceRateLimit(request,env,authorization.actor,'provider-channel-mappings',METHODS);
  if(limited) return limited;
  if(!hasD1(env)) return secureJson({error:'Cloudflare D1 unavailable'},503,request,env,METHODS);
  const actor=authorization.actor;
  const organizationId=orgId(env,actor);

  if(request.method==='GET'){
    if(!actor?.permissions?.includes('read')) return secureJson({error:'Read permission required'},403,request,env,METHODS);
    const url=new URL(request.url);
    const provider=clean(url.searchParams.get('provider')||'E2PAY',40).toUpperCase();
    const environment=clean(url.searchParams.get('environment')||'UAT',20).toUpperCase();
    const rows=await d1All(env.DB,`SELECT * FROM provider_channel_mappings WHERE provider=? AND environment=? ORDER BY purpose,destination_mode,beneficiary_type`,[provider,environment]);
    return secureJson({ok:true,mappings:rows.map(publicMapping)},200,request,env,METHODS);
  }

  if(!roleHasCapability(actor.role,'integrations:manage')) return secureJson({error:'Hanya Super Admin integrations manager yang dapat mengubah provider channel mapping',code:'PROVIDER_CHANNEL_MANAGE_PERMISSION_REQUIRED'},403,request,env,METHODS);
  const body=await request.json().catch(()=>null);
  const action=String(body?.action||'SAVE_DRAFT').toUpperCase();
  const provider=clean(body?.provider||'E2PAY',40).toUpperCase();
  const environment=clean(body?.environment||'UAT',20).toUpperCase();
  const purpose=clean(body?.purpose,30).toUpperCase();
  const destinationMode=clean(body?.destinationMode,40).toUpperCase();
  const beneficiaryType=clean(body?.beneficiaryType,40).toUpperCase();
  if(!['UAT','PRODUCTION'].includes(environment)) return secureJson({error:'Environment tidak valid'},422,request,env,METHODS);
  const allowed=(purpose==='PAYROLL'&&destinationMode==='DIRECT_EMPLOYEE'&&beneficiaryType==='EMPLOYEE')
    ||(purpose==='PAYROLL'&&destinationMode==='CLIENT_ACCOUNT'&&beneficiaryType==='CORPORATE')
    ||(purpose==='EWA'&&destinationMode==='DIRECT_EMPLOYEE'&&beneficiaryType==='EMPLOYEE');
  if(!allowed) return secureJson({error:'Canonical disbursement intent tidak didukung',code:'PROVIDER_CHANNEL_INTENT_UNSUPPORTED'},422,request,env,METHODS);
  const existing=await d1First(env.DB,`SELECT * FROM provider_channel_mappings WHERE provider=? AND environment=? AND purpose=? AND destination_mode=? AND beneficiary_type=? LIMIT 1`,[provider,environment,purpose,destinationMode,beneficiaryType]);

  if(action==='DEACTIVATE_MAPPING'){
    if(!existing) return secureJson({error:'Mapping tidak ditemukan'},404,request,env,METHODS);
    await d1Batch(env.DB,[
      {statement:`UPDATE provider_channel_mappings SET mapping_status='INACTIVE',updated_by=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`,bindings:[actor.email,existing.id]},
      audit(organizationId,actor,'PROVIDER_CHANNEL_MAPPING_DEACTIVATED',`${provider} ${environment} ${purpose}/${destinationMode}/${beneficiaryType}`,existing.id),
    ]);
    return secureJson({ok:true,mapping:publicMapping(await d1First(env.DB,'SELECT * FROM provider_channel_mappings WHERE id=?',[existing.id]))},200,request,env,METHODS);
  }

  const config=canonicalProviderChannelConfig({providerChannel:body?.providerChannel,contractVersion:body?.contractVersion,metadata:body?.metadata});
  if(action==='ACTIVATE_MAPPING'){
    if(!config.providerChannel) return secureJson({error:'Provider channel/kode hasil konfirmasi E2Pay wajib diisi sebelum aktivasi',code:'PROVIDER_CHANNEL_CODE_REQUIRED'},422,request,env,METHODS);
    const confirmationReference=clean(body?.confirmationReference,300);
    if(!confirmationReference) return secureJson({error:'Referensi konfirmasi provider wajib diisi',code:'PROVIDER_CHANNEL_CONFIRMATION_REQUIRED'},422,request,env,METHODS);
    const configHash=await providerChannelConfigHash(config);
    const id=existing?.id||`PCM-${crypto.randomUUID()}`;
    const statement=existing
      ? {statement:`UPDATE provider_channel_mappings SET provider_channel=?,mapping_status='ACTIVE',config_json=?,contract_version=?,config_hash=?,confirmed_by=?,confirmed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),confirmation_reference=?,effective_from=?,effective_until=?,updated_by=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`,bindings:[config.providerChannel,JSON.stringify(config.metadata),config.contractVersion,configHash,actor.email,confirmationReference,clean(body?.effectiveFrom,40)||null,clean(body?.effectiveUntil,40)||null,actor.email,id]}
      : {statement:`INSERT INTO provider_channel_mappings(id,provider,environment,purpose,destination_mode,beneficiary_type,provider_channel,mapping_status,config_json,effective_from,effective_until,created_by,updated_by,contract_version,config_hash,confirmed_by,confirmed_at,confirmation_reference) VALUES(?,?,?,?,?,?,?,'ACTIVE',?,?,?,?,?,?,?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now'),?)`,bindings:[id,provider,environment,purpose,destinationMode,beneficiaryType,config.providerChannel,JSON.stringify(config.metadata),clean(body?.effectiveFrom,40)||null,clean(body?.effectiveUntil,40)||null,actor.email,actor.email,config.contractVersion,configHash,actor.email,confirmationReference]};
    await d1Batch(env.DB,[statement,audit(organizationId,actor,'PROVIDER_CHANNEL_MAPPING_ACTIVATED',`${provider} ${environment} ${purpose}/${destinationMode}/${beneficiaryType} → ${config.providerChannel} · contract=${config.contractVersion} · confirmation=${confirmationReference}`,id)]);
    return secureJson({ok:true,mapping:publicMapping(await d1First(env.DB,'SELECT * FROM provider_channel_mappings WHERE id=?',[id]))},200,request,env,METHODS);
  }

  if(action!=='SAVE_DRAFT') return secureJson({error:'Action tidak didukung'},422,request,env,METHODS);
  const id=existing?.id||`PCM-${crypto.randomUUID()}`;
  const statement=existing
    ? {statement:`UPDATE provider_channel_mappings SET provider_channel=?,mapping_status='PENDING_PROVIDER_CONFIRMATION',config_json=?,contract_version=?,config_hash=NULL,confirmed_by=NULL,confirmed_at=NULL,confirmation_reference=NULL,effective_from=?,effective_until=?,updated_by=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`,bindings:[config.providerChannel||null,JSON.stringify(config.metadata),config.contractVersion,clean(body?.effectiveFrom,40)||null,clean(body?.effectiveUntil,40)||null,actor.email,id]}
    : {statement:`INSERT INTO provider_channel_mappings(id,provider,environment,purpose,destination_mode,beneficiary_type,provider_channel,mapping_status,config_json,effective_from,effective_until,created_by,updated_by,contract_version) VALUES(?,?,?,?,?,?,?,'PENDING_PROVIDER_CONFIRMATION',?,?,?,?,?,?)`,bindings:[id,provider,environment,purpose,destinationMode,beneficiaryType,config.providerChannel||null,JSON.stringify(config.metadata),clean(body?.effectiveFrom,40)||null,clean(body?.effectiveUntil,40)||null,actor.email,actor.email,config.contractVersion]};
  await d1Batch(env.DB,[statement,audit(organizationId,actor,'PROVIDER_CHANNEL_MAPPING_DRAFTED',`${provider} ${environment} ${purpose}/${destinationMode}/${beneficiaryType}`,id)]);
  return secureJson({ok:true,mapping:publicMapping(await d1First(env.DB,'SELECT * FROM provider_channel_mappings WHERE id=?',[id]))},200,request,env,METHODS);
}

import { d1First } from './_d1.js';
import { sha256Hex } from './payment-instruction-core.js';
import { providerChannelKey } from '../../shared/disbursement-contract.js';
import {automaticE2PayRoute,validateAutomaticE2PaySnapshot} from './e2pay-automatic-routing.js';

function clean(value,limit=180){ return String(value??'').trim().replace(/[\r\n\t]+/g,' ').slice(0,limit); }

export function canonicalProviderChannelConfig(input={}){
  const providerChannel=clean(input.providerChannel||input.provider_channel,120).toUpperCase();
  const contractVersion=clean(input.contractVersion||input.contract_version||'1',40);
  const metadata=input.metadata&&typeof input.metadata==='object'&&!Array.isArray(input.metadata)?input.metadata:{};
  // Contract metadata is descriptive only in P5.7.5. Arbitrary URLs, credentials,
  // account source overrides, or raw provider payload fragments are prohibited.
  const safeMetadata={};
  for(const key of ['providerRouteCode','providerPurposeCode','transactionType','descriptionPrefix','notes']){
    if(metadata[key]!==undefined&&metadata[key]!==null) safeMetadata[key]=clean(metadata[key],key==='notes'?500:120);
  }
  return {providerChannel,contractVersion,metadata:safeMetadata};
}

export async function providerChannelConfigHash(config){
  const canonical=canonicalProviderChannelConfig(config);
  return sha256Hex(JSON.stringify(canonical));
}

export function providerChannelSnapshot(mapping){
  let parsed={};
  try{ parsed=JSON.parse(String(mapping?.config_json||'{}'))||{}; }catch{}
  const config=canonicalProviderChannelConfig({
    providerChannel:mapping?.provider_channel,
    contractVersion:mapping?.contract_version,
    metadata:parsed,
  });
  return {
    mappingId:mapping?.id||null,
    provider:String(mapping?.provider||'').toUpperCase(),
    environment:String(mapping?.environment||'').toUpperCase(),
    intentKey:providerChannelKey({purpose:mapping?.purpose,destination_mode:mapping?.destination_mode,beneficiary_type:mapping?.beneficiary_type}),
    providerChannel:config.providerChannel,
    contractVersion:config.contractVersion,
    metadata:config.metadata,
    configHash:mapping?.config_hash||null,
    confirmedAt:mapping?.confirmed_at||null,
  };
}

export async function resolveProviderChannel(database,input={},env={}){
  if(String(input.provider||'').toUpperCase()==='E2PAY')return automaticE2PayRoute(database,env,input);
  return resolveLegacyProviderChannel(database,input);
}

// Retained for historical snapshots; new E2Pay requests always use the SSD profile.
export async function resolveLegacyProviderChannel(database,input={}){
  const provider=String(input.provider||'').trim().toUpperCase();
  const environment=String(input.environment||'').trim().toUpperCase();
  const purpose=String(input.purpose||'').trim().toUpperCase();
  const destinationMode=String(input.destinationMode||input.destination_mode||'').trim().toUpperCase();
  const beneficiaryType=String(input.beneficiaryType||input.beneficiary_type||'').trim().toUpperCase();
  const now=String(input.now||new Date().toISOString());
  const mapping=await d1First(database,`SELECT * FROM provider_channel_mappings
    WHERE provider=? AND environment=? AND purpose=? AND destination_mode=? AND beneficiary_type=?
      AND mapping_status='ACTIVE'
      AND (effective_from IS NULL OR effective_from<=?)
      AND (effective_until IS NULL OR effective_until>?)
    LIMIT 1`,[provider,environment,purpose,destinationMode,beneficiaryType,now,now]);
  if(!mapping) return {ok:false,code:'PROVIDER_CHANNEL_MAPPING_REQUIRED',intentKey:providerChannelKey({purpose,destination_mode:destinationMode,beneficiary_type:beneficiaryType})};
  if(!mapping.provider_channel||!mapping.config_hash||!mapping.confirmed_at) return {ok:false,code:'PROVIDER_CHANNEL_MAPPING_UNVERIFIED'};
  const snapshot=providerChannelSnapshot(mapping);
  const computedHash=await providerChannelConfigHash({providerChannel:mapping.provider_channel,contractVersion:mapping.contract_version,metadata:JSON.parse(String(mapping.config_json||'{}'))});
  if(computedHash!==mapping.config_hash) return {ok:false,code:'PROVIDER_CHANNEL_CONFIG_INTEGRITY_FAILED'};
  return {ok:true,mapping,snapshot};
}

export async function validateProviderChannelSnapshot(database,requestRow,env={}){
  if(!requestRow?.provider_channel_snapshot) return {ok:false,code:'PROVIDER_CHANNEL_SNAPSHOT_REQUIRED'};
  let snapshot;
  try{ snapshot=JSON.parse(String(requestRow.provider_channel_snapshot)); }catch{ return {ok:false,code:'PROVIDER_CHANNEL_SNAPSHOT_INVALID'}; }
  if(!snapshot||typeof snapshot!=='object'||Array.isArray(snapshot))return {ok:false,code:'PROVIDER_CHANNEL_SNAPSHOT_INVALID'};
  if(snapshot?.routingMode==='AUTOMATIC')return validateAutomaticE2PaySnapshot(database,env,requestRow,snapshot);
  if(!requestRow.provider_channel_mapping_id)return {ok:false,code:'PROVIDER_CHANNEL_SNAPSHOT_REQUIRED'};
  const mapping=await d1First(database,'SELECT * FROM provider_channel_mappings WHERE id=? LIMIT 1',[requestRow.provider_channel_mapping_id]);
  if(!mapping) return {ok:false,code:'PROVIDER_CHANNEL_MAPPING_NOT_FOUND'};
  if(String(mapping.mapping_status)!=='ACTIVE') return {ok:false,code:'PROVIDER_CHANNEL_MAPPING_INACTIVE'};
  const current=providerChannelSnapshot(mapping);
  if(current.provider!==String(requestRow.provider||'').toUpperCase()
    || current.environment!==String(requestRow.provider_environment||'').toUpperCase()
    || current.intentKey!==providerChannelKey({purpose:requestRow.purpose,destination_mode:requestRow.destination_mode,beneficiary_type:requestRow.beneficiary_type})
    || current.configHash!==snapshot.configHash
    || current.providerChannel!==snapshot.providerChannel
    || current.contractVersion!==snapshot.contractVersion){
    return {ok:false,code:'PROVIDER_CHANNEL_SNAPSHOT_MISMATCH'};
  }
  const computedHash=await providerChannelConfigHash({providerChannel:mapping.provider_channel,contractVersion:mapping.contract_version,metadata:JSON.parse(String(mapping.config_json||'{}'))});
  if(computedHash!==mapping.config_hash||computedHash!==snapshot.configHash) return {ok:false,code:'PROVIDER_CHANNEL_CONFIG_INTEGRITY_FAILED'};
  return {ok:true,mapping,snapshot:current};
}

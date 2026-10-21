import {d1First} from './_d1.js';
import {instructionContentHash} from './payment-instruction-core.js';

// Older deferred activation commits recipient content before a provider exists.
// Its routing is committed separately by the immutable routing snapshot and the
// server's PAYMENT_ROUTING_BOUND audit event. Never accept a generic hash mismatch.
export async function verifyStoredInstructionHash(database,payment,lines){
  const metadata={organizationId:payment.org_id,clientId:payment.client_id,submissionId:payment.submission_id,
    payrollPeriod:payment.payroll_period,paymentPeriod:payment.payment_period,
    provider:payment.provider||'',providerEnvironment:payment.provider_environment||'',
    providerAccountRegistryId:payment.provider_account_registry_id||'',providerSubAccountId:payment.provider_sub_account_id||''};
  const routedHash=await instructionContentHash(metadata,lines);
  if(routedHash===payment.content_hash)return {valid:true,hash:routedHash,routedHash,mode:'ROUTED'};
  if(payment.provider!=='E2PAY'||!payment.provider_account_registry_id)return {valid:false};
  let snapshot;
  try{snapshot=JSON.parse(payment.provider_account_snapshot||'null');}catch{return {valid:false};}
  if(snapshot?.registryId!==payment.provider_account_registry_id||snapshot.provider!==payment.provider||snapshot.environment!==payment.provider_environment)return {valid:false};
  const originalHash=await instructionContentHash({...metadata,provider:'',providerEnvironment:'',providerAccountRegistryId:'',providerSubAccountId:''},lines);
  if(originalHash!==payment.content_hash)return {valid:false};
  const bound=await d1First(database,`SELECT id FROM audit_logs WHERE org_id=? AND entity='payment_instruction' AND entity_id=? AND action='PAYMENT_ROUTING_BOUND' LIMIT 1`,[payment.org_id,payment.id]);
  if(!bound)return {valid:false};
  return {valid:true,hash:originalHash,routedHash,mode:'DEFERRED_ROUTING_AUDITED'};
}

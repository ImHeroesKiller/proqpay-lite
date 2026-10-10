import { sha256Hex } from './payment-instruction-core.js';
import { validateDisbursementIntent } from '../../shared/disbursement-contract.js';

export function canonicalSourceType(value){
  const source=String(value||'').trim().toUpperCase();
  return source==='PI'?'PAYMENT_INSTRUCTION':source==='EWA'?'EWA_REQUEST':source;
}

export function intentFromSource(sourceDocumentType,destinationMode){
  const source=canonicalSourceType(sourceDocumentType);
  const destination=String(destinationMode||'').trim().toUpperCase();
  if(source==='PAYMENT_INSTRUCTION') return validateDisbursementIntent({
    purpose:'PAYROLL',destinationMode:destination,
    beneficiaryType:destination==='CLIENT_ACCOUNT'?'CORPORATE':'EMPLOYEE',
    sourceDocumentType:'PAYMENT_INSTRUCTION',
  });
  if(source==='EWA_REQUEST') return validateDisbursementIntent({
    purpose:'EWA',destinationMode:destination||'DIRECT_EMPLOYEE',beneficiaryType:'EMPLOYEE',sourceDocumentType:'EWA_REQUEST',
  });
  return {ok:false,code:'DISBURSEMENT_SOURCE_UNSUPPORTED'};
}

export async function disbursementIdentity({orgId,clientId,sourceDocumentType,sourceDocumentId,destinationMode,provider,environment,providerAccountId,amount,items}){
  const canonical={
    orgId:String(orgId),clientId:String(clientId),sourceDocumentType:String(sourceDocumentType),sourceDocumentId:String(sourceDocumentId),
    destinationMode:String(destinationMode),provider:String(provider),environment:String(environment),providerAccountId:String(providerAccountId),
    amount:Number(amount),items:[...items].map((item)=>({sourceItemId:String(item.sourceItemId),beneficiaryHash:String(item.beneficiaryHash),amount:Number(item.amount)})).sort((a,b)=>a.sourceItemId.localeCompare(b.sourceItemId)),
  };
  const routingHash=await sha256Hex(JSON.stringify(canonical));
  const idempotencyKey=await sha256Hex(`DISBURSEMENT|${canonical.orgId}|${canonical.sourceDocumentType}|${canonical.sourceDocumentId}|${canonical.destinationMode}|${canonical.providerAccountId}`);
  return {routingHash,idempotencyKey,clientReference:`PQP-DR-${routingHash.slice(0,24).toUpperCase()}`};
}

export function publicDisbursementRequest(row,items=[]){
  return {
    id:row.id,clientId:row.client_id,projectId:row.project_id||null,provider:row.provider,environment:row.provider_environment,
    providerSubAccountIdMasked:row.provider_sub_account_id_snapshot?'••••'+String(row.provider_sub_account_id_snapshot).slice(-4):null,
    purpose:row.purpose,destinationMode:row.destination_mode,beneficiaryType:row.beneficiary_type,
    sourceDocumentType:row.source_document_type,sourceDocumentId:row.source_document_id,
    amount:Number(row.amount||0),currency:row.currency,recipientCount:Number(row.recipient_count||0),status:row.status,
    clientReference:row.client_reference,correlationId:row.correlation_id,requestedBy:row.requested_by_email||null,requestedAt:row.requested_at||null,
    createdAt:row.created_at,providerChannel:row.provider_channel_snapshot||null,
    items:items.map((item)=>({id:item.id,sequenceNo:Number(item.sequence_no),sourceItemType:item.source_item_type,sourceItemId:item.source_item_id,
      beneficiaryType:item.beneficiary_type,beneficiaryReference:item.beneficiary_reference,employeeId:item.employee_id||null,
      bankCode:item.bank_code,bankName:item.bank_name||null,beneficiaryName:item.beneficiary_name,accountLast4:item.account_number_last4,
      amount:Number(item.amount||0),currency:item.currency,status:item.status,clientReference:item.client_reference})),
  };
}

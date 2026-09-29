import { d1All, d1Batch, d1First, hasD1 } from './_d1.js';
import { employeeBankStorageValue, prepareEmployeeBankAccount } from './_employee-bank-security.js';
import { authorize, enforceRateLimit, handlePreflight, secureJson } from './_security.js';

const METHODS='GET, POST, OPTIONS';
const BATCH_SIZE=100;

async function status(database, organizationId){
  const row=await d1First(database,`SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN b.account_ciphertext IS NOT NULL AND b.account_iv IS NOT NULL AND length(b.account_last4)=4 THEN 1 ELSE 0 END) AS encrypted,
      SUM(CASE WHEN b.account_ciphertext IS NULL AND b.account_no IS NOT NULL AND b.account_no NOT LIKE 'ENC:%' THEN 1 ELSE 0 END) AS legacy_plaintext,
      SUM(CASE WHEN b.account_ciphertext IS NULL AND b.account_no LIKE 'ENC:%' THEN 1 ELSE 0 END) AS invalid_marker_only
    FROM employee_bank_accounts b
    JOIN employees e ON e.id=b.employee_id
    WHERE e.org_id=?`,[organizationId]);
  return {
    total:Number(row?.total||0),
    encrypted:Number(row?.encrypted||0),
    legacyPlaintext:Number(row?.legacy_plaintext||0),
    invalidMarkerOnly:Number(row?.invalid_marker_only||0),
  };
}

export async function onRequest({request,env}){
  if(request.method==='OPTIONS') return handlePreflight(request,env,METHODS);
  if(!['GET','POST'].includes(request.method)) return secureJson({error:'Method not allowed'},405,request,env,METHODS);
  const authorization=await authorize(request,env,{roles:['SUPER_ADMIN'],mutating:request.method==='POST',methods:METHODS});
  if(authorization.response) return authorization.response;
  const actor=authorization.actor;
  const limited=await enforceRateLimit(request,env,actor,'security-bank-migration',METHODS);
  if(limited) return limited;
  if(!hasD1(env)) return secureJson({error:'Cloudflare D1 unavailable'},503,request,env,METHODS);
  const organizationId=String(actor.orgId||env.DEFAULT_ORG_ID||'ORG-OTSINDO');

  if(request.method==='GET'){
    return secureJson({ok:true,status:await status(env.DB,organizationId)},200,request,env,METHODS);
  }

  let body={};
  try{body=await request.json();}catch{return secureJson({error:'Invalid JSON'},400,request,env,METHODS);}
  if(String(body.confirmation||'').trim()!=='ENCRYPT LEGACY BANK ACCOUNTS'){
    return secureJson({
      error:'Konfirmasi wajib: ENCRYPT LEGACY BANK ACCOUNTS',
      code:'BANK_MIGRATION_CONFIRMATION_REQUIRED',
    },422,request,env,METHODS);
  }

  const rows=await d1All(env.DB,`SELECT b.id,b.employee_id,b.bank_name,b.account_no
    FROM employee_bank_accounts b
    JOIN employees e ON e.id=b.employee_id
    WHERE e.org_id=?
      AND b.account_ciphertext IS NULL
      AND b.account_no IS NOT NULL
      AND b.account_no NOT LIKE 'ENC:%'
    ORDER BY b.id
    LIMIT ?`,[organizationId,BATCH_SIZE]);

  const operations=[];
  const failed=[];
  for(const row of rows){
    try{
      const secured=await prepareEmployeeBankAccount(row.account_no,env);
      operations.push({
        statement:`UPDATE employee_bank_accounts SET
          account_no=?,
          account_ciphertext=?,
          account_iv=?,
          account_last4=?,
          account_fingerprint=?,
          encrypted_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
          WHERE id=? AND account_ciphertext IS NULL`,
        bindings:[
          employeeBankStorageValue(secured),
          secured.ciphertext,
          secured.iv,
          secured.last4,
          secured.fingerprint,
          row.id,
        ],
      });
    }catch(error){
      failed.push({
        id:row.id,
        employeeId:row.employee_id,
        reason:String(error?.message||error).slice(0,160),
      });
    }
  }

  if(operations.length){
    operations.push({
      statement:`INSERT INTO audit_logs(id,org_id,username,role,action,detail,entity,entity_id,ip_hash,device_hash)
        VALUES(?,?,?,?,? ,?,'security_control',?,?,?)`,
      bindings:[
        `AUD-${crypto.randomUUID()}`,
        organizationId,
        actor.email,
        actor.role,
        'EMPLOYEE_BANK_ENCRYPTION_MIGRATED',
        JSON.stringify({migrated:operations.length,failed:failed.length,batchSize:BATCH_SIZE}),
        organizationId,
        actor.requestIpHash||null,
        actor.requestDeviceHash||null,
      ],
    });
    await d1Batch(env.DB,operations);
  }

  const next=await status(env.DB,organizationId);
  return secureJson({
    ok:failed.length===0,
    migrated:Math.max(0,operations.length-(operations.length?1:0)),
    failed,
    remaining:next.legacyPlaintext,
    status:next,
    done:next.legacyPlaintext===0 && next.invalidMarkerOnly===0,
  },failed.length?207:200,request,env,METHODS);
}

import { d1All, d1First, hasD1 } from './_d1.js';
import { authorize, enforceRateLimit, handlePreflight, secureJson } from './_security.js';
import { gatewayRuntimeEnv } from './payment-gateway-settings-store.js';
import { providerAccountCredentialState } from './payment-provider-account-credentials.js';
import { deriveClientReadiness } from './client-readiness-core.js';

const METHODS='GET, OPTIONS';
function orgId(env,actor){ return String(actor?.orgId||env.DEFAULT_ORG_ID||'ORG-OTSINDO'); }

export async function onRequest({request,env}){
  if(request.method==='OPTIONS') return handlePreflight(request,env,METHODS);
  if(request.method!=='GET') return secureJson({error:'Method not allowed'},405,request,env,METHODS);
  const authorization=await authorize(request,env,{methods:METHODS});
  if(authorization.response) return authorization.response;
  const limited=await enforceRateLimit(request,env,authorization.actor,'client-readiness',METHODS);
  if(limited) return limited;
  if(!hasD1(env)) return secureJson({error:'Cloudflare D1 unavailable'},503,request,env,METHODS);
  const organizationId=orgId(env,authorization.actor);
  const url=new URL(request.url);
  const requestedClientId=String(url.searchParams.get('clientId')||'').trim();
  const runtimeEnv=await gatewayRuntimeEnv(env.DB,env,organizationId);
  const environment=String(runtimeEnv.E2PAY_ENV||'UAT').toUpperCase();
  const clients=await d1All(env.DB,`SELECT c.id,c.code,c.name,c.status,
      (SELECT COUNT(*) FROM employees e WHERE e.client_id=c.id) AS employee_count,
      (SELECT COUNT(*) FROM payroll_submissions ps WHERE ps.client_id=c.id) AS payroll_count
    FROM clients c WHERE c.org_id=? ${requestedClientId?'AND c.id=?':''} ORDER BY c.name`,
    requestedClientId?[organizationId,requestedClientId]:[organizationId]);
  const result=[];
  for(const client of clients){
    const account=await d1First(env.DB,`SELECT ppa.*,pps.state AS provisioning_session_state
      FROM payment_provider_accounts ppa
      LEFT JOIN provider_provisioning_sessions pps ON pps.provider_account_registry_id=ppa.id
      WHERE ppa.org_id=? AND ppa.client_id=? AND ppa.project_id IS NULL
        AND ppa.provider='E2PAY' AND ppa.environment=?
      ORDER BY CASE ppa.status WHEN 'ACTIVE' THEN 0 WHEN 'DRAFT' THEN 1 ELSE 2 END,ppa.updated_at DESC LIMIT 1`,
      [organizationId,client.id,environment]);
    const credential=providerAccountCredentialState(account||{});
    result.push({
      clientId:client.id,clientCode:client.code,clientName:client.name,environment,
      readiness:deriveClientReadiness({
        clientStatus:client.status,
        employeeCount:client.employee_count,
        payrollCount:client.payroll_count,
        providerStatus:account?.status,
        providerSubAccountId:account?.provider_sub_account_id,
        provisioningState:account?.provisioning_session_state,
        credentialReady:credential.ready,
      }),
      provider:account?{accountId:account.id,status:account.status,subAccountIdMasked:account.provider_sub_account_id?'••••'+String(account.provider_sub_account_id).slice(-4):null,provisioningState:account.provisioning_session_state||null,credentialReady:credential.ready}:null,
    });
  }
  return secureJson({ok:true,environment,clients:result},200,request,env,METHODS);
}

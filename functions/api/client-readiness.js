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
  // One Master E2Pay provider account is shared across clients in this organization.
  const master=await d1First(env.DB,`SELECT * FROM payment_provider_accounts
    WHERE org_id=? AND provider='E2PAY' AND environment=? AND account_scope='MASTER'
    ORDER BY CASE status WHEN 'ACTIVE' THEN 0 ELSE 1 END,updated_at DESC LIMIT 1`,[organizationId,environment]);
  const masterCredential=providerAccountCredentialState(master||{});
  const result=clients.map(client=>({
    clientId:client.id,clientCode:client.code,clientName:client.name,environment,
    readiness:deriveClientReadiness({
      clientStatus:client.status,
      employeeCount:client.employee_count,
      payrollCount:client.payroll_count,
      masterAccountStatus:master?.status,
      masterAccountScope:master?.account_scope,
      masterCredentialReady:masterCredential.ready,
    }),
    provider:master?{
      accountId:master.id,status:master.status,accountScope:'MASTER',
      credentialReady:masterCredential.ready,
    }:null,
  }));

  return secureJson({ok:true,environment,clients:result},200,request,env,METHODS);
}

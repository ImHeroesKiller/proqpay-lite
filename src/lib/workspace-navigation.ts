import type {AppView} from '@/components/Sidebar';

export type PayrollStage='PAYROLL'|'PAYMENT'|'CLOSE';
export const PAYROLL_STAGE_VIEW:Record<PayrollStage,AppView>={PAYROLL:'operations',PAYMENT:'payments',CLOSE:'billing'};
export const PAYROLL_STAGE_URL:Record<PayrollStage,string>={PAYROLL:'payroll',PAYMENT:'payment',CLOSE:'close'};
const ALL_VIEWS=new Set<AppView>(['dashboard','operations','exceptions','payments','billing','integrations','employees','clients','reports','logs','ewa','portalSettings']);

export function validAppView(value:string|null):AppView|null {
  if(value==='payment-instructions')return 'payments'; // Previous P5.7 recovery links.
  if(value==='portalAudit')return 'logs';
  return ALL_VIEWS.has(value as AppView)?value as AppView:null;
}
export function payrollStage(value:string|null):PayrollStage|null {
  if(value==='payroll')return 'PAYROLL';
  if(value==='payment')return 'PAYMENT';
  if(value==='close')return 'CLOSE';
  return null;
}
export function stageForView(value:AppView):PayrollStage {
  return value==='payments'?'PAYMENT':value==='billing'?'CLOSE':'PAYROLL';
}
export function allowedPayrollView(view:AppView):boolean {
  return ['operations','exceptions','payments','billing'].includes(view);
}
export function normalizeInternalRoute(view:AppView,stageValue:string|null,internal:boolean):{view:AppView;stage:PayrollStage|null}{
  if(!internal||!allowedPayrollView(view))return {view,stage:null};
  // Explicit stage owns visible parent tab as well as the URL.
  const stage=payrollStage(stageValue)||stageForView(view);
  return {view:view==='exceptions' && stage==='PAYROLL'?'exceptions':PAYROLL_STAGE_VIEW[stage],stage};
}
export function recoveryReturnUrl(accountId:string,period:string|null):string {
  const params=new URLSearchParams({view:'payments',stage:'payment',paymentPanel:'FUNDING',fundingAccountId:accountId,recoveryComplete:'1'});
  if(period)params.set('period',period);
  return `/?${params.toString()}`;
}

export function resolveRecoveryTarget<
  Client extends {id:string},
  Project extends {id:string;client_id:string},
  Account extends {id:string;clientId:string|null;projectId?:string|null},
>(clientId:string,accountId:string,accounts:Account[],clients:Client[],projects:Project[]):
  |{kind:'client';target:Client;account:Account}
  |{kind:'project';target:Project;account:Account}
  |{error:'ACCOUNT_NOT_FOUND'|'CLIENT_NOT_FOUND'|'PROJECT_NOT_FOUND'} {
  const account=accounts.find(row=>row.id===accountId&&row.clientId===clientId);
  if(!account)return {error:'ACCOUNT_NOT_FOUND'};
  const client=clients.find(row=>row.id===clientId);
  if(!client)return {error:'CLIENT_NOT_FOUND'};
  if(account.projectId){
    const project=projects.find(row=>row.id===account.projectId&&row.client_id===clientId);
    return project?{kind:'project',target:project,account}:{error:'PROJECT_NOT_FOUND'};
  }
  return {kind:'client',target:client,account};
}

export function exceptionCenterUrl(submissionId:string):string {
  const params=new URLSearchParams({view:'exceptions',stage:'payroll',submissionId});
  return `/?${params.toString()}`;
}

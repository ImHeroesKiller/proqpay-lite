import { d1Batch, d1First } from './_d1.js';
import { authorize, handlePreflight, secureJson } from './_security.js';
import { handleD1OperatingModel } from './operating-model-d1.js';
import { gatewayRuntimeEnv } from './payment-gateway-settings-store.js';

const METHODS='POST, OPTIONS';
const FIXTURE_CLIENT_ID='CLI-E2PAY-UAT-DUMMY';
const FIXTURE_PROJECT_ID='PRJ-E2PAY-UAT-DUMMY';
const FIXTURE_PLAN_ID='SP-E2PAY-UAT-DUMMY';
const DUMMY_ACCOUNT='701075327';
const DUMMY_BANK='PERMATA';
const FIXTURES=[
  { key:'SINGLE', submissionId:'SUB-E2PAY-UAT-001', period:'2099-01', recipients:1, amount:15000 },
  { key:'DOUBLE', submissionId:'SUB-E2PAY-UAT-002', period:'2099-02', recipients:2, amount:15000 },
  { key:'TRIPLE', submissionId:'SUB-E2PAY-UAT-003', period:'2099-03', recipients:3, amount:15000 },
  { key:'FIVE', submissionId:'SUB-E2PAY-UAT-005', period:'2099-05', recipients:5, amount:15000 },
];

function internalRequest(body){
  return new Request('https://proqpay.internal/api/operating-model',{
    method:'POST',
    headers:{'Content-Type':'application/json','Origin':'https://proqpay.internal','Sec-Fetch-Site':'same-origin'},
    body:JSON.stringify(body),
  });
}

async function operating(env,actor,body){
  const response=await handleD1OperatingModel({request:internalRequest(body),env},actor);
  const payload=await response.json().catch(()=>({}));
  if(!response.ok){
    const error=new Error(payload.error||`Operating-model action failed: ${body.action}`);
    error.code=payload.code||'UAT_FIXTURE_ACTION_FAILED';
    error.status=response.status;
    throw error;
  }
  return payload;
}

async function seedFixtureSource(database,organizationId,actorEmail){
  await d1Batch(database,[
    {
      statement:`INSERT INTO clients
        (id,org_id,code,name,status,payment_terms_days,tax_status,billing_method,billing_rate,billing_admin_fee,billing_tax_rate)
        VALUES(?,?,?,'[UAT] E2Pay Dummy Disbursement','ACTIVE',0,'NON_PKP','PER_EMPLOYEE',0,0,0)
        ON CONFLICT(id) DO UPDATE SET name=excluded.name,status='ACTIVE'`,
      bindings:[FIXTURE_CLIENT_ID,organizationId,'E2PAY-UAT-DUMMY'],
    },
    {
      statement:`INSERT INTO projects(id,org_id,client_id,code,name,description,service_type,status,created_by)
        VALUES(?,?,?,?,?,'Synthetic project for E2Pay UAT dummy disbursement only','PAYROLL','ACTIVE',?)
        ON CONFLICT(id) DO UPDATE SET name=excluded.name,status='ACTIVE',updated_at=datetime('now')`,
      bindings:[FIXTURE_PROJECT_ID,organizationId,FIXTURE_CLIENT_ID,'E2PAY-UAT-DUMMY','[UAT] E2Pay Dummy Disbursement',actorEmail],
    },
    {
      statement:`INSERT INTO client_service_plans(id,client_id,tier,status,effective_from,created_by)
        VALUES(?,?,?,'ACTIVE','2026-01-01',?)
        ON CONFLICT(id) DO UPDATE SET status='ACTIVE',updated_at=datetime('now')`,
      bindings:[FIXTURE_PLAN_ID,FIXTURE_CLIENT_ID,'TIER_1_PAYMENT_PROCESSING',actorEmail],
    },
  ]);

  for(const fixture of FIXTURES){
    const existingPi=await d1First(database,
      `SELECT id,status FROM payment_instructions WHERE submission_id=? AND org_id=? AND status<>'REJECTED' ORDER BY created_at DESC LIMIT 1`,
      [fixture.submissionId,organizationId]);

    if(!existingPi){
      await d1Batch(database,[{
        statement:`INSERT INTO payroll_submissions
          (id,org_id,client_id,project_id,service_plan_id,service_tier,period,payment_period,state,created_by,
           processor_reviewed_at,processor_reviewed_by,processor_review_note,
           controller_reviewed_at,controller_reviewed_by,controller_review_note,
           client_reviewed_at,client_reviewed_by,client_review_note,client_review_decision)
          VALUES(?,?,?,?,?,?,?,?,'CLIENT_APPROVED',?,
            datetime('now'),'uat-maker@proqpay.local','UAT fixture prepared',
            datetime('now'),'uat-controller@proqpay.local','UAT fixture controller review',
            datetime('now'),'uat-client@proqpay.local','UAT fixture client approval','APPROVED')
          ON CONFLICT(id) DO UPDATE SET
            state=CASE WHEN payroll_submissions.state IN ('DRAFT','SUBMITTED','CLIENT_APPROVAL_PENDING','CLIENT_APPROVED') THEN 'CLIENT_APPROVED' ELSE payroll_submissions.state END,
            client_reviewed_at=COALESCE(payroll_submissions.client_reviewed_at,datetime('now')),
            client_reviewed_by=COALESCE(payroll_submissions.client_reviewed_by,'uat-client@proqpay.local'),
            client_review_decision=COALESCE(payroll_submissions.client_review_decision,'APPROVED'),
            updated_at=datetime('now')`,
        bindings:[
          fixture.submissionId,organizationId,FIXTURE_CLIENT_ID,FIXTURE_PROJECT_ID,FIXTURE_PLAN_ID,
          'TIER_1_PAYMENT_PROCESSING',fixture.period,fixture.period,actorEmail,
        ],
      }]);
    }

    for(let index=1; index<=fixture.recipients; index+=1){
      const suffix=String(index).padStart(2,'0');
      const employeeId=`EMP-E2PAY-${fixture.key}-${suffix}`;
      const bankId=`BANK-E2PAY-${fixture.key}-${suffix}`;
      const employeeCode=`E2P-${fixture.key}-${suffix}`;
      await d1Batch(database,[
        {
          statement:`INSERT INTO employees(id,org_id,client_id,project_id,employee_code,name,status_aktif)
            VALUES(?,?,?,?,?,?,'ACTIVE')
            ON CONFLICT(id) DO UPDATE SET name=excluded.name,status_aktif='ACTIVE',updated_at=datetime('now')`,
          bindings:[employeeId,organizationId,FIXTURE_CLIENT_ID,FIXTURE_PROJECT_ID,employeeCode,`[UAT] Dummy Recipient ${fixture.key} ${suffix}`],
        },
        {
          statement:`INSERT INTO employee_compensation
            (employee_id,basic_salary,payroll_source_period,imported_gross,imported_deduction,imported_net)
            VALUES(?,?,?,?,0,?)
            ON CONFLICT(employee_id) DO UPDATE SET
              basic_salary=excluded.basic_salary,payroll_source_period=excluded.payroll_source_period,
              imported_gross=excluded.imported_gross,imported_deduction=0,imported_net=excluded.imported_net,updated_at=datetime('now')`,
          bindings:[employeeId,fixture.amount,fixture.period,fixture.amount,fixture.amount],
        },
        {
          statement:`INSERT INTO employee_bank_accounts(id,employee_id,bank_name,account_no,is_primary)
            VALUES(?,?,?, ?,1)
            ON CONFLICT(id) DO UPDATE SET bank_name=excluded.bank_name,account_no=excluded.account_no,is_primary=1`,
          bindings:[bankId,employeeId,DUMMY_BANK,DUMMY_ACCOUNT],
        },
      ]);
    }
  }
}

async function advanceFixture(env,fixture){
  const maker={
    id:`UAT-MAKER-${fixture.key}`,
    email:'uat-maker@proqpay.local',
    role:'PAYROLL_PROCESSOR',
    permissions:['payment:prepare'],
  };
  const controller={
    id:`UAT-CONTROLLER-${fixture.key}`,
    email:'uat-controller@proqpay.local',
    role:'PAYROLL_CONTROLLER',
    permissions:['payment:approve','reconciliation:write'],
  };
  let pi=await d1First(env.DB,
    `SELECT * FROM payment_instructions WHERE submission_id=? AND org_id=? AND status<>'REJECTED' ORDER BY created_at DESC LIMIT 1`,
    [fixture.submissionId,env.DEFAULT_ORG_ID]);

  if(!pi){
    const generated=await operating(env,maker,{action:'GENERATE_PAYMENT_INSTRUCTION',submissionId:fixture.submissionId});
    pi=generated.paymentInstruction;
  }

  if(pi.status==='PAYMENT_INSTRUCTION_READY'){
    await operating(env,maker,{action:'SUBMIT_PAYMENT_INSTRUCTION',paymentInstructionId:pi.id,confirmation:'SUBMIT PI'});
    pi=await d1First(env.DB,'SELECT * FROM payment_instructions WHERE id=?',[pi.id]);
  }

  if(pi.status==='PAYMENT_APPROVAL_PENDING'){
    await operating(env,controller,{
      action:'APPROVE_PAYMENT',
      paymentInstructionId:pi.id,
      actionHash:pi.content_hash,
      confirmation:'KONFIRMASI PAYMENT',
    });
    pi=await d1First(env.DB,'SELECT * FROM payment_instructions WHERE id=?',[pi.id]);
  }

  const gateway=await d1First(env.DB,
    `SELECT id,status,provider_status FROM payment_gateway_transactions WHERE payment_instruction_id=? ORDER BY created_at DESC LIMIT 1`,
    [pi.id]);

  return {
    key:fixture.key,
    paymentInstructionId:pi.id,
    documentNo:pi.document_no,
    status:pi.status,
    recipients:Number(pi.recipient_count||0),
    total:Number(pi.expected_total||0),
    gatewayTransaction:gateway||null,
  };
}

export async function onRequest({request,env}){
  if(request.method==='OPTIONS') return handlePreflight(request,env,METHODS);
  if(request.method!=='POST') return secureJson({error:'Method not allowed'},405,request,env,METHODS);

  const authorization=await authorize(request,env,{roles:['SUPER_ADMIN'],mutating:true,methods:METHODS});
  if(authorization.response) return authorization.response;

  let body={};
  try{ body=await request.json(); }catch{}
  if(body.confirmation!=='CREATE E2PAY UAT PI'){
    return secureJson({error:'Konfirmasi wajib: CREATE E2PAY UAT PI',code:'UAT_FIXTURE_CONFIRMATION_REQUIRED'},422,request,env,METHODS);
  }

  const organizationId=String(authorization.actor.orgId||env.DEFAULT_ORG_ID||'ORG-OTSINDO');
  const runtime=await gatewayRuntimeEnv(env.DB,env,organizationId);
  if(String(runtime.PAYMENT_GATEWAY_PROVIDER||'').toUpperCase()!=='E2PAY'
    || String(runtime.E2PAY_ENV||'').toUpperCase()!=='UAT'){
    return secureJson({
      error:'Fixture PI hanya dapat dibuat saat E2Pay UAT menjadi gateway aktif.',
      code:'E2PAY_UAT_REQUIRED',
      provider:String(runtime.PAYMENT_GATEWAY_PROVIDER||'UNCONFIGURED'),
      environment:String(runtime.E2PAY_ENV||''),
    },409,request,env,METHODS);
  }

  const scopedEnv=Object.assign(Object.create(env||null),runtime,{DEFAULT_ORG_ID:organizationId});
  try{
    await seedFixtureSource(env.DB,organizationId,authorization.actor.email);
    const fixtures=[];
    for(const fixture of FIXTURES) fixtures.push(await advanceFixture(scopedEnv,fixture));
    await d1Batch(env.DB,[{
      statement:`INSERT INTO audit_logs(id,org_id,username,role,action,detail,entity,entity_id)
        VALUES(?,?,?,?,?,?,?,?)`,
      bindings:[
        `AUD-${crypto.randomUUID()}`,organizationId,authorization.actor.email,authorization.actor.role,
        'E2PAY_UAT_PI_FIXTURES_READY',
        JSON.stringify(fixtures.map((item)=>({id:item.paymentInstructionId,documentNo:item.documentNo,status:item.status,total:item.total,recipients:item.recipients}))),
        'payment_instruction','E2PAY-UAT-FIXTURES',
      ],
    }]);
    return secureJson({
      ok:true,
      environment:'UAT',
      provider:'E2PAY',
      dummyDestination:{bank:'Permata',bankId:'permata',accountId:DUMMY_ACCOUNT},
      fixtures,
    },201,request,env,METHODS);
  }catch(error){
    return secureJson({
      error:String(error?.message||error),
      code:error?.code||'E2PAY_UAT_FIXTURE_FAILED',
    },Number(error?.status)||500,request,env,METHODS);
  }
}

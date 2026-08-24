import assert from 'node:assert/strict';
import test from 'node:test';
import { onRequest as importEmployees } from '../functions/api/import.js';
import { D1Mock } from './helpers/d1-mock.mjs';

test('legacy JSON import cannot bypass canonical payroll provenance for 396 recipients',async()=>{
  const DB=new D1Mock();
  DB.sqlite.exec(`
    INSERT INTO clients(id,org_id,code,name) VALUES('CLI','ORG-OTSINDO','CLI','PT Client');
    INSERT INTO projects(id,org_id,client_id,code,name,created_by) VALUES('PRJ','ORG-OTSINDO','CLI','PRJ','Project','seed');
    INSERT INTO client_service_plans(id,client_id,tier,status,effective_from,created_by)
      VALUES('SP','CLI','TIER_1_PAYMENT_PROCESSING','ACTIVE','2026-01-01','seed');
  `);
  const rows=Array.from({length:396},(_,index)=>({nrk:`EMP-${String(index+1).padStart(3,'0')}`,name:`Employee ${index+1}`,
    client:'PT Client',clientCode:'CLI',branch:'Jakarta',lokasi:'Jakarta',province:'DKI Jakarta',basicSalary:4000000,
    grossPay:4000000,totalDeductions:0,netPay:4000000,bank:index%2?'MANDIRI':'BCA',accountNo:`123456${String(index+1).padStart(4,'0')}`}));
  const origin='https://proqpay.test',body=JSON.stringify({rows,context:{clientId:'CLI',projectId:'PRJ',servicePlanId:'SP',tier:'TIER_1_PAYMENT_PROCESSING',period:'2026-08'}});
  const response=await importEmployees({request:new Request(`${origin}/api/import`,{method:'POST',headers:{Origin:origin,'Sec-Fetch-Site':'same-origin','Content-Type':'application/json'},body}),env:{DB,DEFAULT_ORG_ID:'ORG-OTSINDO'}});
  assert.equal(response.status,409,await response.clone().text());
  assert.equal((await response.json()).code,'PAYROLL_PROVENANCE_REQUIRED');
  assert.equal(DB.sqlite.prepare('SELECT COUNT(*) AS n FROM payroll_submissions').get().n,0);
});

test('legacy JSON import stays closed even for historically valid service tiers',async()=>{
  const DB=new D1Mock();
  DB.sqlite.exec(`
    INSERT INTO clients(id,org_id,code,name) VALUES('CLI-HIST','ORG-OTSINDO','HIST','PT Historical');
    INSERT INTO projects(id,org_id,client_id,code,name,created_by) VALUES('PRJ-HIST','ORG-OTSINDO','CLI-HIST','HIST','Historical Project','seed');
    INSERT INTO client_service_plans(id,client_id,tier,status,effective_from,effective_until,created_by)
      VALUES('SP-HIST','CLI-HIST','TIER_1_PAYMENT_PROCESSING','ACTIVE','2025-01-01','2025-06-30','seed');
  `);
  const rows=[{nrk:'EMP-HIST-001',name:'Historical Employee',client:'PT Historical',clientCode:'HIST',branch:'Jakarta',lokasi:'Jakarta',province:'DKI Jakarta',basicSalary:5000000,grossPay:5000000,totalDeductions:0,netPay:5000000,bank:'BCA',accountNo:'1234567890'}];
  const origin='https://proqpay.test';
  const body=JSON.stringify({rows,context:{clientId:'CLI-HIST',projectId:'PRJ-HIST',servicePlanId:'SP-HIST',tier:'TIER_1_PAYMENT_PROCESSING',period:'2025-06'}});
  const response=await importEmployees({request:new Request(`${origin}/api/import`,{method:'POST',headers:{Origin:origin,'Sec-Fetch-Site':'same-origin','Content-Type':'application/json'},body}),env:{DB,DEFAULT_ORG_ID:'ORG-OTSINDO'}});
  assert.equal(response.status,409,await response.clone().text());
  assert.equal((await response.json()).code,'PAYROLL_PROVENANCE_REQUIRED');
});

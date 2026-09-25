import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { savePortalSettings } from '../functions/api/_portal-settings.js';
import { D1Mock } from './helpers/d1-mock.mjs';

const read=(path)=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('Employee Services P1: Portal Settings saves policy, presentation, ads and audit atomically',async()=>{
  const DB=new D1Mock();
  DB.sqlite.exec(`
    INSERT OR IGNORE INTO organizations(id,name,code) VALUES('ORG-P1','Org P1','P1');
    INSERT OR IGNORE INTO clients(id,org_id,code,name,status) VALUES('CLI-P1','ORG-P1','P1','Client P1','ACTIVE');
    CREATE TRIGGER fail_portal_settings_audit
      BEFORE INSERT ON audit_logs
      WHEN NEW.action='PORTAL_SETTINGS_SAVED'
      BEGIN SELECT RAISE(ABORT,'forced audit failure'); END;
  `);
  await assert.rejects(
    savePortalSettings(DB,{
      orgId:'ORG-P1',clientId:'CLI-P1',
      actor:{email:'admin@p1.test',role:'SUPER_ADMIN'},
      policy:{enabled:true,maxPercent:0.2,feeRate:0.02,minFee:20000,minFeeAmount:1000000,maxTenorMonths:1,minDaysWorked:5,minTenureMonths:0,minTenureDays:0},
      copy:{companyTagline:'P1 Portal',ewaTitle:'Advance P1'},
      features:{adsEnabled:true},
      adsPlatform:{provider:'NONE'},
      ads:[{title:'P1 banner',tag:'P1',desc:'P1',cta:'Buka',action:'EWA',enabled:true}],
    }),
    /forced audit failure/,
  );
  assert.equal(DB.sqlite.prepare("SELECT COUNT(*) n FROM ewa_policies WHERE org_id='ORG-P1' AND client_id='CLI-P1'").get().n,0);
  assert.equal(DB.sqlite.prepare("SELECT COUNT(*) n FROM portal_settings WHERE org_id='ORG-P1' AND client_id='CLI-P1'").get().n,0);
  assert.equal(DB.sqlite.prepare("SELECT COUNT(*) n FROM portal_ads WHERE org_id='ORG-P1' AND client_id='CLI-P1'").get().n,0);

  DB.sqlite.exec('DROP TRIGGER fail_portal_settings_audit');
  await savePortalSettings(DB,{
    orgId:'ORG-P1',clientId:'CLI-P1',
    actor:{email:'admin@p1.test',role:'SUPER_ADMIN'},
    policy:{enabled:true,maxPercent:0.2,feeRate:0.02,minFee:20000,minFeeAmount:1000000,maxTenorMonths:1,minDaysWorked:5,minTenureMonths:0,minTenureDays:0},
    copy:{companyTagline:'P1 Portal',ewaTitle:'Advance P1'},
    features:{adsEnabled:true},
    adsPlatform:{provider:'NONE'},
    ads:[{title:'P1 banner',tag:'P1',desc:'P1',cta:'Buka',action:'EWA',enabled:true}],
  });
  assert.equal(DB.sqlite.prepare("SELECT COUNT(*) n FROM ewa_policies WHERE org_id='ORG-P1' AND client_id='CLI-P1'").get().n,1);
  assert.equal(DB.sqlite.prepare("SELECT COUNT(*) n FROM portal_settings WHERE org_id='ORG-P1' AND client_id='CLI-P1'").get().n,1);
  assert.equal(DB.sqlite.prepare("SELECT COUNT(*) n FROM portal_ads WHERE org_id='ORG-P1' AND client_id='CLI-P1'").get().n,1);
  assert.equal(DB.sqlite.prepare("SELECT COUNT(*) n FROM audit_logs WHERE org_id='ORG-P1' AND action='PORTAL_SETTINGS_SAVED'").get().n,1);
});

test('Employee Services P1: EWA ops supports bounded filters and pagination',async()=>{
  const api=await read('functions/api/ewa.js');
  assert.match(api,/params\.get\('clientId'\)/);
  assert.match(api,/params\.get\('period'\)/);
  assert.match(api,/params\.get\('q'\)/);
  assert.match(api,/LIMIT \? OFFSET \?/);
  assert.match(api,/Math\.min\(100/);
  assert.match(api,/filteredTotal/);
  const ui=await read('src/components/EwaInbox.tsx');
  assert.match(ui,/type="month"/);
  assert.match(ui,/Reset filter/);
  assert.match(ui,/Berikutnya/);
  assert.match(ui,/void disburse\(row\.id\)/);
});

test('Employee Services P1: Portal Audit is scoped, searchable and excludes generic employee-master noise',async()=>{
  const api=await read('functions/api/portal-audit.js');
  assert.match(api,/kindRaw/);
  assert.match(api,/LIMIT \? OFFSET \?/);
  assert.match(api,/entity IN \('ewa_request','employee_credentials'\)/);
  assert.doesNotMatch(api,/entity IN \('ewa_request', 'employee_credentials', 'employee'\)/);
  assert.match(api,/EMPLOYEE_PORTAL_PASSWORDS_ISSUED/);
  const ui=await read('src/components/PortalAudit.tsx');
  assert.match(ui,/Cari audit portal/);
  assert.match(ui,/Berikutnya/);
});

test('Employee Services P1: Lite publishes a versioned contract for ESS init, EWA and payslips',async()=>{
  const contract=await read('functions/api/_employee-contract.js');
  const init=await read('functions/api/employee/init.js');
  const ewa=await read('functions/api/employee/ewa.js');
  const slips=await read('functions/api/employee/payslips.js');
  assert.match(contract,/2026-09-v1/);
  for(const source of [init,ewa,slips]) assert.match(source,/EMPLOYEE_SERVICES_CONTRACT_VERSION/);
});

test('Employee Services P1: Portal Settings mutation is implemented with D1 batch transaction',async()=>{
  const settings=await read('functions/api/_portal-settings.js');
  assert.match(settings,/d1Batch/);
  assert.match(settings,/PORTAL_SETTINGS_RESET/);
  assert.match(settings,/PORTAL_SETTINGS_SAVED/);
  assert.doesNotMatch(settings,/await d1Run\(/);
});

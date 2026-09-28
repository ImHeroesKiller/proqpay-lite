PRAGMA foreign_keys = ON;

-- Idempotent remote-only seed for a fresh isolated E2Pay UAT dataset.
-- This file is NOT a D1 migration and is executed only by the production deploy
-- workflow after schema migrations. No PI/payment approval/provider transaction
-- is inserted here.

INSERT OR IGNORE INTO clients (
  id,org_id,code,name,website,industry,contact_name,contact_email,contact_phone,
  status,npwp,nitku,billing_address,billing_email,billing_cc_email,payment_terms_days,
  tax_status,purchase_order,billing_method,billing_rate,billing_admin_fee,billing_tax_rate,
  ar_payment_block_mode,ar_warning_days
) VALUES (
  'CLI-E2PAY-UAT-FRESH','ORG-OTSINDO','E2PAY-UAT-FRESH','PT ProQPay E2Pay UAT Dummy',
  'https://example.invalid','UAT / Synthetic','UAT Finance','uat.finance@example.invalid','080000000001',
  'ACTIVE','00.000.000.0-000.000','0000000000000000000000',
  'Alamat UAT sintetis - bukan alamat riil','uat.billing@example.invalid','uat.cc@example.invalid',30,
  'NON_PKP','PO-UAT-E2PAY-202609','PER_EMPLOYEE',0,0,0,'OFF',7
);

INSERT OR IGNORE INTO projects (
  id,org_id,client_id,code,name,description,service_type,status,start_date,end_date,province,created_by
) VALUES (
  'PRJ-E2PAY-UAT-FRESH','ORG-OTSINDO','CLI-E2PAY-UAT-FRESH','E2PAY-UAT-FRESH',
  'E2Pay UAT Payment Execution','Dataset sintetis untuk pengujian payment gateway E2Pay UAT end-to-end.',
  'PAYROLL_PROCESSING','ACTIVE','2026-09-01','2026-12-31','DKI Jakarta','system:uat-seed'
);

INSERT OR IGNORE INTO client_service_plans (
  id,client_id,tier,status,contract_reference,effective_from,effective_until,created_by
) VALUES (
  'SP-E2PAY-UAT-FRESH','CLI-E2PAY-UAT-FRESH','TIER_1_PAYMENT_PROCESSING','ACTIVE',
  'UAT-E2PAY-202609','2026-09-01','2026-12-31','system:uat-seed'
);

INSERT OR IGNORE INTO employees (
  id,org_id,client_id,project_id,employee_code,name,gender,birth_place,birth_date,religion,
  phone,mobile,email,mother_name,status_aktif,province
) VALUES
('EMP-E2PAY-UAT-001','ORG-OTSINDO','CLI-E2PAY-UAT-FRESH','PRJ-E2PAY-UAT-FRESH','E2UAT-001','Dummy Employee 01','M','Jakarta','1990-01-01','-',NULL,'080000000101','dummy01@example.invalid','Dummy Mother 01','ACTIVE','DKI Jakarta'),
('EMP-E2PAY-UAT-002','ORG-OTSINDO','CLI-E2PAY-UAT-FRESH','PRJ-E2PAY-UAT-FRESH','E2UAT-002','Dummy Employee 02','F','Jakarta','1991-02-02','-',NULL,'080000000102','dummy02@example.invalid','Dummy Mother 02','ACTIVE','DKI Jakarta'),
('EMP-E2PAY-UAT-003','ORG-OTSINDO','CLI-E2PAY-UAT-FRESH','PRJ-E2PAY-UAT-FRESH','E2UAT-003','Dummy Employee 03','M','Bandung','1992-03-03','-',NULL,'080000000103','dummy03@example.invalid','Dummy Mother 03','ACTIVE','Jawa Barat'),
('EMP-E2PAY-UAT-004','ORG-OTSINDO','CLI-E2PAY-UAT-FRESH','PRJ-E2PAY-UAT-FRESH','E2UAT-004','Dummy Employee 04','F','Surabaya','1993-04-04','-',NULL,'080000000104','dummy04@example.invalid','Dummy Mother 04','ACTIVE','Jawa Timur'),
('EMP-E2PAY-UAT-005','ORG-OTSINDO','CLI-E2PAY-UAT-FRESH','PRJ-E2PAY-UAT-FRESH','E2UAT-005','Dummy Employee 05','M','Medan','1994-05-05','-',NULL,'080000000105','dummy05@example.invalid','Dummy Mother 05','ACTIVE','Sumatera Utara');

INSERT OR IGNORE INTO employee_identity (employee_id,ktp_no,npwp_no,address,marital_status,ptkp_claimed,ptkp_updated) VALUES
('EMP-E2PAY-UAT-001','9900000000000001','00.000.000.0-001.000','Alamat dummy 01','SINGLE','TK/0','2026-09-01'),
('EMP-E2PAY-UAT-002','9900000000000002','00.000.000.0-002.000','Alamat dummy 02','SINGLE','TK/0','2026-09-01'),
('EMP-E2PAY-UAT-003','9900000000000003','00.000.000.0-003.000','Alamat dummy 03','MARRIED','K/0','2026-09-01'),
('EMP-E2PAY-UAT-004','9900000000000004','00.000.000.0-004.000','Alamat dummy 04','MARRIED','K/1','2026-09-01'),
('EMP-E2PAY-UAT-005','9900000000000005','00.000.000.0-005.000','Alamat dummy 05','SINGLE','TK/0','2026-09-01');

INSERT OR IGNORE INTO employee_contracts (
  id,employee_id,employment_type,contract_status,join_date,accepted_date,contract_start,contract_end,is_current
) VALUES
('CTR-E2PAY-UAT-001','EMP-E2PAY-UAT-001','PKWT','ACTIVE','2026-09-01','2026-09-01','2026-09-01','2026-12-31',1),
('CTR-E2PAY-UAT-002','EMP-E2PAY-UAT-002','PKWT','ACTIVE','2026-09-01','2026-09-01','2026-09-01','2026-12-31',1),
('CTR-E2PAY-UAT-003','EMP-E2PAY-UAT-003','PKWT','ACTIVE','2026-09-01','2026-09-01','2026-09-01','2026-12-31',1),
('CTR-E2PAY-UAT-004','EMP-E2PAY-UAT-004','PKWT','ACTIVE','2026-09-01','2026-09-01','2026-09-01','2026-12-31',1),
('CTR-E2PAY-UAT-005','EMP-E2PAY-UAT-005','PKWT','ACTIVE','2026-09-01','2026-09-01','2026-09-01','2026-12-31',1);

INSERT OR IGNORE INTO employee_assignments (id,employee_id,position,pic,hrbp,effective_from,is_current) VALUES
('ASN-E2PAY-UAT-001','EMP-E2PAY-UAT-001','UAT Recipient 01','UAT PIC','UAT HRBP','2026-09-01',1),
('ASN-E2PAY-UAT-002','EMP-E2PAY-UAT-002','UAT Recipient 02','UAT PIC','UAT HRBP','2026-09-01',1),
('ASN-E2PAY-UAT-003','EMP-E2PAY-UAT-003','UAT Recipient 03','UAT PIC','UAT HRBP','2026-09-01',1),
('ASN-E2PAY-UAT-004','EMP-E2PAY-UAT-004','UAT Recipient 04','UAT PIC','UAT HRBP','2026-09-01',1),
('ASN-E2PAY-UAT-005','EMP-E2PAY-UAT-005','UAT Recipient 05','UAT PIC','UAT HRBP','2026-09-01',1);

INSERT OR IGNORE INTO employee_compensation (
  employee_id,basic_salary,salary_start,currency,payroll_source_period,imported_gross,imported_deduction,imported_net,payroll_components
) VALUES
('EMP-E2PAY-UAT-001',15000,'2026-09-01','IDR','2026-09',15000,0,15000,'{"uat":true,"component":"E2Pay Dummy Net"}'),
('EMP-E2PAY-UAT-002',25000,'2026-09-01','IDR','2026-09',25000,0,25000,'{"uat":true,"component":"E2Pay Dummy Net"}'),
('EMP-E2PAY-UAT-003',35000,'2026-09-01','IDR','2026-09',35000,0,35000,'{"uat":true,"component":"E2Pay Dummy Net"}'),
('EMP-E2PAY-UAT-004',45000,'2026-09-01','IDR','2026-09',45000,0,45000,'{"uat":true,"component":"E2Pay Dummy Net"}'),
('EMP-E2PAY-UAT-005',55000,'2026-09-01','IDR','2026-09',55000,0,55000,'{"uat":true,"component":"E2Pay Dummy Net"}');

INSERT OR IGNORE INTO employee_bank_accounts (id,employee_id,bank_name,account_no,is_primary) VALUES
('BANK-E2PAY-UAT-001','EMP-E2PAY-UAT-001','BCA','111111000001',1),
('BANK-E2PAY-UAT-002','EMP-E2PAY-UAT-002','MANDIRI','111111000002',1),
('BANK-E2PAY-UAT-003','EMP-E2PAY-UAT-003','BRI','111111000003',1),
('BANK-E2PAY-UAT-004','EMP-E2PAY-UAT-004','BNI','111111000004',1),
('BANK-E2PAY-UAT-005','EMP-E2PAY-UAT-005','PERMATA','111111000005',1);

INSERT OR IGNORE INTO employee_bpjs (employee_id,bpjs_kesehatan_no,bpjs_kesehatan_effective,jamsostek_no) VALUES
('EMP-E2PAY-UAT-001','UAT-BPJSKES-001','2026-09-01','UAT-BPJSTK-001'),
('EMP-E2PAY-UAT-002','UAT-BPJSKES-002','2026-09-01','UAT-BPJSTK-002'),
('EMP-E2PAY-UAT-003','UAT-BPJSKES-003','2026-09-01','UAT-BPJSTK-003'),
('EMP-E2PAY-UAT-004','UAT-BPJSKES-004','2026-09-01','UAT-BPJSTK-004'),
('EMP-E2PAY-UAT-005','UAT-BPJSKES-005','2026-09-01','UAT-BPJSTK-005');

INSERT OR IGNORE INTO payroll_submissions (
  id,org_id,client_id,project_id,service_plan_id,service_tier,period,payment_period,state,created_by,
  run_type,source_mode,payment_date,input_status,period_status,
  controller_reviewed_at,controller_reviewed_by,controller_review_note,
  client_reviewed_at,client_reviewed_by,client_review_note,client_review_decision
) VALUES (
  'SUB-E2PAY-UAT-FRESH-001','ORG-OTSINDO','CLI-E2PAY-UAT-FRESH','PRJ-E2PAY-UAT-FRESH',
  'SP-E2PAY-UAT-FRESH','TIER_1_PAYMENT_PROCESSING','2026-09','2026-09','CLIENT_APPROVED','system:uat-seed',
  'REGULAR','MASTER_CURRENT','2026-09-30','READY','OPEN',
  datetime('now'),'uat.controller.seed@proqpay.test','Synthetic UAT payroll review evidence only; not a payment approval.',
  datetime('now'),'uat.client.seed@proqpay.test','Synthetic UAT client payroll approval for isolated dummy dataset.','APPROVED'
);

INSERT OR IGNORE INTO audit_logs (id,org_id,username,role,action,detail,entity,entity_id)
VALUES (
  'AUD-E2PAY-UAT-FRESH-SEED','ORG-OTSINDO','system:uat-seed','SYSTEM',
  'E2PAY_UAT_FRESH_DATASET_SEEDED',
  'Fresh isolated E2Pay UAT dataset created: 5 synthetic employees, total payroll Rp175.000. No PI, payment approval, gateway transaction, or provider payment was pre-created.',
  'payroll_submission','SUB-E2PAY-UAT-FRESH-001'
);

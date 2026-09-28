PRAGMA foreign_keys = ON;

-- Remediate the one-time E2Pay UAT fixtures that were advanced by an internal
-- synthetic Controller helper. Final payment confirmation must be performed by
-- a real authenticated PAYROLL_CONTROLLER.
--
-- Fail safe: do not change any fixture that already has a gateway transaction.
UPDATE payment_approvals
SET status='INVALIDATED'
WHERE status='APPROVED'
  AND approver_user_id LIKE 'UAT-CONTROLLER-%'
  AND payment_instruction_id IN (
    SELECT pi.id
    FROM payment_instructions pi
    WHERE pi.submission_id IN (
      'SUB-E2PAY-UAT-001',
      'SUB-E2PAY-UAT-002',
      'SUB-E2PAY-UAT-003',
      'SUB-E2PAY-UAT-005'
    )
      AND NOT EXISTS (
        SELECT 1 FROM payment_gateway_transactions pgt
        WHERE pgt.payment_instruction_id=pi.id
      )
  );

UPDATE payment_instructions
SET status='PAYMENT_APPROVAL_PENDING',
    updated_at=datetime('now')
WHERE submission_id IN (
    'SUB-E2PAY-UAT-001',
    'SUB-E2PAY-UAT-002',
    'SUB-E2PAY-UAT-003',
    'SUB-E2PAY-UAT-005'
  )
  AND status='APPROVED_FOR_PAYMENT'
  AND NOT EXISTS (
    SELECT 1 FROM payment_gateway_transactions pgt
    WHERE pgt.payment_instruction_id=payment_instructions.id
  );

UPDATE payroll_submissions
SET state='PAYMENT_APPROVAL_PENDING',
    updated_at=datetime('now')
WHERE id IN (
    'SUB-E2PAY-UAT-001',
    'SUB-E2PAY-UAT-002',
    'SUB-E2PAY-UAT-003',
    'SUB-E2PAY-UAT-005'
  )
  AND state='APPROVED_FOR_PAYMENT'
  AND EXISTS (
    SELECT 1 FROM payment_instructions pi
    WHERE pi.submission_id=payroll_submissions.id
      AND pi.status='PAYMENT_APPROVAL_PENDING'
  );

INSERT INTO audit_logs(id,org_id,username,role,action,detail,entity,entity_id)
SELECT
  'AUD-' || lower(hex(randomblob(16))),
  pi.org_id,
  'system',
  'SYSTEM',
  'E2PAY_UAT_SYNTHETIC_APPROVAL_INVALIDATED',
  'Synthetic UAT approval invalidated. Real Payroll Controller confirmation is required before payment execution.',
  'payment_instruction',
  pi.id
FROM payment_instructions pi
WHERE pi.submission_id IN (
    'SUB-E2PAY-UAT-001',
    'SUB-E2PAY-UAT-002',
    'SUB-E2PAY-UAT-003',
    'SUB-E2PAY-UAT-005'
  )
  AND pi.status='PAYMENT_APPROVAL_PENDING'
  AND EXISTS (
    SELECT 1 FROM payment_approvals pa
    WHERE pa.payment_instruction_id=pi.id
      AND pa.status='INVALIDATED'
      AND pa.approver_user_id LIKE 'UAT-CONTROLLER-%'
  )
  AND NOT EXISTS (
    SELECT 1 FROM audit_logs al
    WHERE al.action='E2PAY_UAT_SYNTHETIC_APPROVAL_INVALIDATED'
      AND al.entity='payment_instruction'
      AND al.entity_id=pi.id
  );

PRAGMA foreign_keys = ON;

-- Forward-only guard: a receipt/reference may not be allocated to a different AR
-- for the same client. The same reference may still create both an applied
-- payment and unapplied cash on the same AR when an overpayment is split.
CREATE TRIGGER IF NOT EXISTS ar_payment_reference_cross_ar_guard
BEFORE INSERT ON ar_payments
WHEN EXISTS(
  SELECT 1
  FROM ar_monitor current_ar
  JOIN (
    SELECT ap.ar_id,ap.reference FROM ar_payments ap
    UNION ALL
    SELECT uc.ar_id,uc.reference FROM unapplied_cash uc WHERE uc.status<>'VOID'
  ) existing ON existing.reference=NEW.reference
  JOIN ar_monitor existing_ar ON existing_ar.id=existing.ar_id
  WHERE current_ar.id=NEW.ar_id
    AND existing_ar.client_id=current_ar.client_id
    AND existing_ar.id<>current_ar.id
)
BEGIN
  SELECT RAISE(ABORT, 'AR payment reference already allocated to another receivable');
END;

CREATE TRIGGER IF NOT EXISTS unapplied_cash_reference_cross_ar_guard
BEFORE INSERT ON unapplied_cash
WHEN NEW.status<>'VOID' AND EXISTS(
  SELECT 1
  FROM ar_monitor current_ar
  JOIN (
    SELECT ap.ar_id,ap.reference FROM ar_payments ap
    UNION ALL
    SELECT uc.ar_id,uc.reference FROM unapplied_cash uc WHERE uc.status<>'VOID'
  ) existing ON existing.reference=NEW.reference
  JOIN ar_monitor existing_ar ON existing_ar.id=existing.ar_id
  WHERE current_ar.id=NEW.ar_id
    AND existing_ar.client_id=current_ar.client_id
    AND existing_ar.id<>current_ar.id
)
BEGIN
  SELECT RAISE(ABORT, 'AR payment reference already allocated to another receivable');
END;

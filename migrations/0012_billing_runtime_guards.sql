PRAGMA foreign_keys = ON;

-- Forward-only guards: they do not scan/reject historical duplicates, but prevent new ones.
CREATE TRIGGER IF NOT EXISTS ar_monitor_one_per_invoice_insert
BEFORE INSERT ON ar_monitor
WHEN NEW.invoice_id IS NOT NULL
  AND EXISTS(SELECT 1 FROM ar_monitor WHERE invoice_id=NEW.invoice_id)
BEGIN
  SELECT RAISE(ABORT, 'UNIQUE constraint failed: ar_monitor.invoice_id');
END;

CREATE TRIGGER IF NOT EXISTS ar_payment_reference_once_insert
BEFORE INSERT ON ar_payments
WHEN EXISTS(SELECT 1 FROM ar_payments WHERE ar_id=NEW.ar_id AND reference=NEW.reference)
BEGIN
  SELECT RAISE(ABORT, 'UNIQUE constraint failed: ar_payments.ar_id, ar_payments.reference');
END;

CREATE TRIGGER IF NOT EXISTS unapplied_cash_reference_once_insert
BEFORE INSERT ON unapplied_cash
WHEN NEW.status<>'VOID'
  AND EXISTS(SELECT 1 FROM unapplied_cash WHERE ar_id=NEW.ar_id AND reference=NEW.reference AND status<>'VOID')
BEGIN
  SELECT RAISE(ABORT, 'UNIQUE constraint failed: unapplied_cash.ar_id, unapplied_cash.reference');
END;

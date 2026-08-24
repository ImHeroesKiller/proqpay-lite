-- Enforce maker-checker separation for invoice approval at the database layer.
-- This applies to every role, including SUPER_ADMIN.
CREATE TRIGGER IF NOT EXISTS invoice_maker_checker_update
BEFORE UPDATE OF status, approved_by ON invoices
WHEN NEW.status = 'APPROVED'
  AND lower(trim(COALESCE(NEW.created_by, ''))) = lower(trim(COALESCE(NEW.approved_by, '')))
BEGIN
  SELECT RAISE(ABORT, 'Invoice maker cannot approve the same invoice');
END;

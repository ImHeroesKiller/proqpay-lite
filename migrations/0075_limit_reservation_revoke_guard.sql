-- Protect in-flight reservations even when revoke races a canonical reservation.
CREATE TRIGGER e2pay_limit_revoke_reservation_guard
BEFORE UPDATE OF status ON e2pay_disbursement_limit_requests
WHEN NEW.status='REVOKED' AND OLD.status='ACTIVE' AND (
  EXISTS(SELECT 1 FROM e2pay_disbursement_limit_usage u WHERE u.limit_request_id=OLD.id AND u.status='RESERVED')
  OR EXISTS(SELECT 1 FROM e2pay_disbursement_request_limit_usage u WHERE u.limit_request_id=OLD.id AND u.status='RESERVED'))
BEGIN SELECT RAISE(ABORT,'E2PAY_LIMIT_HAS_ACTIVE_RESERVATION'); END;

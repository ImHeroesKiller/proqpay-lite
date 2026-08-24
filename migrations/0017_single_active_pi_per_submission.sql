-- A submission may retain rejected revisions, but only one live/canonical PI.
CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_instructions_one_active_per_submission
  ON payment_instructions(org_id, submission_id)
  WHERE status <> 'REJECTED';

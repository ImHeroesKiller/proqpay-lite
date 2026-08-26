-- A rejected Payment Instruction remains immutable history. A later revision may
-- intentionally have identical business content after the Processor confirms it.
DROP INDEX IF EXISTS idx_payment_instruction_content_hash;
CREATE INDEX IF NOT EXISTS idx_payment_instruction_content_hash
  ON payment_instructions(org_id, content_hash) WHERE content_hash IS NOT NULL;

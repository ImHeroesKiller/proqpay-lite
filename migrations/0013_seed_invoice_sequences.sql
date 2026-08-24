PRAGMA foreign_keys = ON;

-- Seed the atomic sequence from historical invoice numbers so the first
-- post-migration invoice cannot reuse an existing sequence.
INSERT INTO invoice_sequences(org_id, period, next_number, updated_at)
SELECT org_id,
       period,
       COALESCE(MAX(CASE
         WHEN invoice_number GLOB 'INV/*/*/[0-9][0-9][0-9][0-9]'
           THEN CAST(substr(invoice_number, -4) AS INTEGER)
         ELSE 0
       END), 0) + 1,
       datetime('now')
FROM invoices
WHERE period IS NOT NULL
GROUP BY org_id, period
ON CONFLICT(org_id, period) DO UPDATE SET
  next_number = MAX(invoice_sequences.next_number, excluded.next_number),
  updated_at = excluded.updated_at;

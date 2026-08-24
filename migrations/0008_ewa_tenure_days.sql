PRAGMA foreign_keys = ON;

-- Masa kerja advance bisa diukur hari (bukan hanya bulan kalender). Additive.

ALTER TABLE ewa_policies ADD COLUMN min_tenure_days INTEGER NOT NULL DEFAULT 0;

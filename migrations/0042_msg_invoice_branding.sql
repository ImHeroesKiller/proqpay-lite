PRAGMA foreign_keys = ON;

-- Canonical MSG issuer identity sourced from Company Profile 2026.
ALTER TABLE billing_issuer_profiles ADD COLUMN website TEXT;

INSERT OR IGNORE INTO billing_issuer_profiles
  (org_id,legal_name,address,email,phone,website,updated_by,updated_at)
SELECT
  id,
  'PT Mandiri Semesta Gemilang',
  'Graha MSG, Jl. Raya Pos Pengumben Raya No.Kav 188, Klp. Dua, Kec. Kb. Jeruk, Kota Jakarta Barat, Daerah Khusus Ibukota Jakarta 11550',
  'rizal@msg-os.com',
  '+62 856-9766-6101',
  'www.msg-os.com',
  'MIGRATION_0042',
  datetime('now')
FROM organizations;

UPDATE billing_issuer_profiles
SET legal_name='PT Mandiri Semesta Gemilang',
    address='Graha MSG, Jl. Raya Pos Pengumben Raya No.Kav 188, Klp. Dua, Kec. Kb. Jeruk, Kota Jakarta Barat, Daerah Khusus Ibukota Jakarta 11550',
    email='rizal@msg-os.com',
    phone='+62 856-9766-6101',
    website='www.msg-os.com',
    updated_by='MIGRATION_0042',
    updated_at=datetime('now');

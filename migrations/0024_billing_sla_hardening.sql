PRAGMA foreign_keys = ON;

-- Forward-only hardening for Billing SLA after migration 0023 has already
-- shipped. Do not edit/replay 0023 in production.

ALTER TABLE business_calendar_years ADD COLUMN expected_national_holiday_count INTEGER
  CHECK (expected_national_holiday_count IS NULL OR expected_national_holiday_count BETWEEN 1 AND 366);

UPDATE business_calendar_years
SET expected_national_holiday_count=17,
    updated_at=datetime('now')
WHERE country_code='ID' AND year=2026 AND status='OFFICIAL';

-- Exactly one ACTIVE policy per client-level or project-level scope. If
-- historical duplicates exist this migration intentionally fails closed so the
-- deployment stops after the pre-deploy D1 backup instead of choosing a winner.
CREATE UNIQUE INDEX idx_one_active_client_sla_policy
  ON billing_sla_policies(org_id, client_id)
  WHERE status='ACTIVE' AND project_id IS NULL;

CREATE UNIQUE INDEX idx_one_active_project_sla_policy
  ON billing_sla_policies(org_id, client_id, project_id)
  WHERE status='ACTIVE' AND project_id IS NOT NULL;

-- 0023 could only CHECK json_valid(). Enforce array shape forward-only without
-- rebuilding the financial-history table.
CREATE TRIGGER billing_sla_policy_triggers_array_insert
BEFORE INSERT ON billing_sla_policies
WHEN json_type(NEW.required_triggers) <> 'array'
BEGIN
  SELECT RAISE(ABORT, 'billing_sla_policies.required_triggers must be a JSON array');
END;

CREATE TRIGGER billing_sla_policy_triggers_array_update
BEFORE UPDATE OF required_triggers ON billing_sla_policies
WHEN json_type(NEW.required_triggers) <> 'array'
BEGIN
  SELECT RAISE(ABORT, 'billing_sla_policies.required_triggers must be a JSON array');
END;

-- NATIONAL_HOLIDAY is never a business day in ID_OFFICIAL mode. Company and
-- collective-leave overrides remain separately configurable.
CREATE TRIGGER business_calendar_national_holiday_insert
BEFORE INSERT ON business_calendar_days
WHEN NEW.day_type='NATIONAL_HOLIDAY' AND NEW.is_business_day<>0
BEGIN
  SELECT RAISE(ABORT, 'NATIONAL_HOLIDAY cannot be a business day');
END;

CREATE TRIGGER business_calendar_national_holiday_update
BEFORE UPDATE OF day_type,is_business_day ON business_calendar_days
WHEN NEW.day_type='NATIONAL_HOLIDAY' AND NEW.is_business_day<>0
BEGIN
  SELECT RAISE(ABORT, 'NATIONAL_HOLIDAY cannot be a business day');
END;

-- OFFICIAL calendars require a source, an expected national-holiday count, and
-- a currently matching set. New years therefore follow PROVISIONAL -> load days
-- -> OFFICIAL. This prevents an empty year from being marked official.
CREATE TRIGGER business_calendar_year_official_insert
BEFORE INSERT ON business_calendar_years
WHEN NEW.status='OFFICIAL' AND (
  NEW.source_reference IS NULL OR trim(NEW.source_reference)='' OR
  NEW.expected_national_holiday_count IS NULL OR
  (SELECT COUNT(*) FROM business_calendar_days d
    WHERE d.country_code=NEW.country_code AND d.calendar_year=NEW.year AND d.day_type='NATIONAL_HOLIDAY') <> NEW.expected_national_holiday_count
)
BEGIN
  SELECT RAISE(ABORT, 'OFFICIAL business calendar is incomplete');
END;

CREATE TRIGGER business_calendar_year_official_update
BEFORE UPDATE OF status,expected_national_holiday_count,source_reference ON business_calendar_years
WHEN NEW.status='OFFICIAL' AND (
  NEW.source_reference IS NULL OR trim(NEW.source_reference)='' OR
  NEW.expected_national_holiday_count IS NULL OR
  (SELECT COUNT(*) FROM business_calendar_days d
    WHERE d.country_code=NEW.country_code AND d.calendar_year=NEW.year AND d.day_type='NATIONAL_HOLIDAY') <> NEW.expected_national_holiday_count
)
BEGIN
  SELECT RAISE(ABORT, 'OFFICIAL business calendar is incomplete');
END;

-- Once a year is OFFICIAL, changing its national-holiday count must first
-- demote the year to PROVISIONAL. Metadata changes that keep the count intact
-- remain possible and auditable through the API.
CREATE TRIGGER business_calendar_days_official_insert_guard
AFTER INSERT ON business_calendar_days
WHEN EXISTS(
  SELECT 1 FROM business_calendar_years y
  WHERE y.country_code=NEW.country_code AND y.year=NEW.calendar_year AND y.status='OFFICIAL'
    AND (SELECT COUNT(*) FROM business_calendar_days d
      WHERE d.country_code=y.country_code AND d.calendar_year=y.year AND d.day_type='NATIONAL_HOLIDAY') <> y.expected_national_holiday_count
)
BEGIN
  SELECT RAISE(ABORT, 'OFFICIAL business calendar holiday count changed');
END;

CREATE TRIGGER business_calendar_days_official_update_guard
AFTER UPDATE ON business_calendar_days
WHEN EXISTS(
  SELECT 1 FROM business_calendar_years y
  WHERE y.country_code=NEW.country_code AND y.year=NEW.calendar_year AND y.status='OFFICIAL'
    AND (SELECT COUNT(*) FROM business_calendar_days d
      WHERE d.country_code=y.country_code AND d.calendar_year=y.year AND d.day_type='NATIONAL_HOLIDAY') <> y.expected_national_holiday_count
)
BEGIN
  SELECT RAISE(ABORT, 'OFFICIAL business calendar holiday count changed');
END;

CREATE TRIGGER business_calendar_days_official_delete_guard
AFTER DELETE ON business_calendar_days
WHEN EXISTS(
  SELECT 1 FROM business_calendar_years y
  WHERE y.country_code=OLD.country_code AND y.year=OLD.calendar_year AND y.status='OFFICIAL'
    AND (SELECT COUNT(*) FROM business_calendar_days d
      WHERE d.country_code=y.country_code AND d.calendar_year=y.year AND d.day_type='NATIONAL_HOLIDAY') <> y.expected_national_holiday_count
)
BEGIN
  SELECT RAISE(ABORT, 'OFFICIAL business calendar holiday count changed');
END;
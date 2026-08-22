PRAGMA foreign_keys = ON;

ALTER TABLE client_service_plans ADD COLUMN project_id TEXT REFERENCES projects(id);

UPDATE client_service_plans
SET project_id = (SELECT MIN(p.id) FROM projects p WHERE p.client_id=client_service_plans.client_id)
WHERE project_id IS NULL
  AND (SELECT COUNT(*) FROM projects p WHERE p.client_id=client_service_plans.client_id)=1;

CREATE INDEX idx_service_plans_project_effective
  ON client_service_plans(project_id, effective_from, effective_until, status);

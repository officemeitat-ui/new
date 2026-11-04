-- Security review 2 (docs/SECURITY.md).

-- Directories a company was once connected to: written in the company's context when it
-- disconnects, read only by the system check that keeps a directory bound to one company.
ALTER TABLE integration_directory_history ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE integration_directory_history FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY integration_directory_history_read ON integration_directory_history FOR SELECT
  USING (app_is_system() OR tenant_id = app_current_tenant());
--> statement-breakpoint
CREATE POLICY integration_directory_history_insert ON integration_directory_history FOR INSERT
  WITH CHECK (app_is_system() OR tenant_id = app_current_tenant());
--> statement-breakpoint
CREATE POLICY integration_directory_history_delete ON integration_directory_history FOR DELETE
  USING (app_is_system());
--> statement-breakpoint

-- Only the partner (or the system) may allow BookStack and Atera for a company – not the
-- company's own admins, even though they may update other settings of their tenant row.
CREATE OR REPLACE FUNCTION tenants_guard_partner_flags() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NEW.partner_sources_allowed IS DISTINCT FROM OLD.partner_sources_allowed
     AND NOT app_is_system()
     AND app_current_partner() IS DISTINCT FROM NEW.partner_id THEN
    RAISE EXCEPTION 'partner_sources_allowed can only be changed by the partner';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER tenants_guard_partner_flags BEFORE UPDATE ON tenants
  FOR EACH ROW EXECUTE FUNCTION tenants_guard_partner_flags();
--> statement-breakpoint

-- Public QR page: a request that knows a facility's token sees exactly that facility and the
-- name and status of its company – nothing else, and without the system context.
CREATE OR REPLACE FUNCTION app_public_token() RETURNS text
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT nullif(current_setting('app.public_token', true), '') $$;
--> statement-breakpoint
CREATE POLICY facilities_public_token ON facilities FOR SELECT
  USING (app_public_token() IS NOT NULL AND public_token = app_public_token());
--> statement-breakpoint
CREATE POLICY tenants_public_token ON tenants FOR SELECT
  USING (
    app_public_token() IS NOT NULL
    AND id IN (SELECT f.tenant_id FROM facilities f WHERE f.public_token = app_public_token())
  );

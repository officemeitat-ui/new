-- Integrations are tenant data. Partners see neither connections nor their details here.
ALTER TABLE integrations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE integrations FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY integrations_tenant ON integrations
  USING (app_is_system() OR tenant_id = app_current_tenant())
  WITH CHECK (app_is_system() OR tenant_id = app_current_tenant());

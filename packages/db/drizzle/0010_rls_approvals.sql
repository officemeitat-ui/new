-- Approvals are tenant data (M9).
ALTER TABLE approvals ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE approvals FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY approvals_tenant ON approvals
  USING (app_is_system() OR tenant_id = app_current_tenant())
  WITH CHECK (app_is_system() OR tenant_id = app_current_tenant());

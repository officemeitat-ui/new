-- Facilities and their defect reports are tenant data. The public report page reaches a
-- facility only through its token (system context, one row) and writes in the tenant context.
ALTER TABLE facilities ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE facilities FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY facilities_tenant ON facilities
  USING (app_is_system() OR tenant_id = app_current_tenant())
  WITH CHECK (app_is_system() OR tenant_id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE defect_reports ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE defect_reports FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY defect_reports_tenant ON defect_reports
  USING (app_is_system() OR tenant_id = app_current_tenant())
  WITH CHECK (app_is_system() OR tenant_id = app_current_tenant());

-- Synced knowledge sources (SharePoint libraries) are tenant data.
ALTER TABLE knowledge_sources ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE knowledge_sources FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY knowledge_sources_tenant ON knowledge_sources
  USING (app_is_system() OR tenant_id = app_current_tenant())
  WITH CHECK (app_is_system() OR tenant_id = app_current_tenant());

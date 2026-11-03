-- Knowledge base content is tenant data (M5). Partners never see documents.
ALTER TABLE knowledge_collections ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE knowledge_collections FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY knowledge_collections_tenant ON knowledge_collections
  USING (app_is_system() OR tenant_id = app_current_tenant())
  WITH CHECK (app_is_system() OR tenant_id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE knowledge_documents ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE knowledge_documents FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY knowledge_documents_tenant ON knowledge_documents
  USING (app_is_system() OR tenant_id = app_current_tenant())
  WITH CHECK (app_is_system() OR tenant_id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE knowledge_files ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE knowledge_files FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY knowledge_files_tenant ON knowledge_files
  USING (app_is_system() OR tenant_id = app_current_tenant())
  WITH CHECK (app_is_system() OR tenant_id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE knowledge_chunks ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE knowledge_chunks FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY knowledge_chunks_tenant ON knowledge_chunks
  USING (app_is_system() OR tenant_id = app_current_tenant())
  WITH CHECK (app_is_system() OR tenant_id = app_current_tenant());

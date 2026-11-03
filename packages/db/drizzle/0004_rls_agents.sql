-- Row Level Security for agents, conversations, runs and usage (Phase 2).
-- Tenant data only; partners see usage figures of their own tenants (margin view, M12),
-- never conversations, messages or traces.

ALTER TABLE agents ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE agents FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY agents_tenant ON agents
  USING (app_is_system() OR tenant_id = app_current_tenant())
  WITH CHECK (app_is_system() OR tenant_id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE agent_versions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE agent_versions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY agent_versions_tenant ON agent_versions
  USING (app_is_system() OR tenant_id = app_current_tenant())
  WITH CHECK (app_is_system() OR tenant_id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE conversations FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY conversations_tenant ON conversations
  USING (app_is_system() OR tenant_id = app_current_tenant())
  WITH CHECK (app_is_system() OR tenant_id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE messages FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Messages are append-only: there is no UPDATE policy (thinking blocks must stay unchanged).
CREATE POLICY messages_read ON messages FOR SELECT
  USING (app_is_system() OR tenant_id = app_current_tenant());
--> statement-breakpoint
CREATE POLICY messages_append ON messages FOR INSERT
  WITH CHECK (app_is_system() OR tenant_id = app_current_tenant());
--> statement-breakpoint
CREATE POLICY messages_delete ON messages FOR DELETE
  USING (app_is_system() OR tenant_id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE runs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE runs FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY runs_tenant ON runs
  USING (app_is_system() OR tenant_id = app_current_tenant())
  WITH CHECK (app_is_system() OR tenant_id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE run_steps ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE run_steps FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY run_steps_tenant ON run_steps
  USING (app_is_system() OR tenant_id = app_current_tenant())
  WITH CHECK (app_is_system() OR tenant_id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE usage_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE usage_events FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY usage_events_tenant ON usage_events
  USING (app_is_system() OR tenant_id = app_current_tenant())
  WITH CHECK (app_is_system() OR tenant_id = app_current_tenant());
--> statement-breakpoint
CREATE POLICY usage_events_partner_read ON usage_events FOR SELECT
  USING (tenant_id IN (SELECT t.id FROM tenants t WHERE t.partner_id = app_current_partner()));

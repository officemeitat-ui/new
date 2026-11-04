-- Agent packages belong to the partner (ADR 0009). Tenants never read them; the rollout
-- copies a package into the tenant's own agents.
ALTER TABLE partner_agent_templates ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE partner_agent_templates FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY partner_agent_templates_partner ON partner_agent_templates
  USING (app_is_system() OR partner_id = app_current_partner())
  WITH CHECK (app_is_system() OR partner_id = app_current_partner());
--> statement-breakpoint
-- The partner sees the rollout state of the agents it rolled out to its own tenants (version,
-- adapted or not, archived) – never other agents and never agent versions or conversations.
CREATE POLICY agents_partner_rollout_read ON agents FOR SELECT
  USING (
    partner_template_id IS NOT NULL
    AND tenant_id IN (SELECT t.id FROM tenants t WHERE t.partner_id = app_current_partner())
  );

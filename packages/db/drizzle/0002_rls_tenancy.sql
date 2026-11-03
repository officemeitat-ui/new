-- Row Level Security for identity and tenancy tables.
-- See docs/adr/0002-mandanten-isolation-rls.md. Every policy allows the system context
-- (app_is_system()) plus the narrowest context that legitimately needs the rows.
--
-- Rule against policy recursion: policies may look into `tenants` and `memberships`,
-- but the policies of those two tables never look into each other in a cycle.

CREATE OR REPLACE FUNCTION app_current_user() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;
--> statement-breakpoint

-- memberships: the tenant sees its members; a user sees their own memberships (to pick a tenant).
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE memberships FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY memberships_access ON memberships
  USING (app_is_system() OR tenant_id = app_current_tenant() OR user_id = app_current_user())
  WITH CHECK (app_is_system() OR tenant_id = app_current_tenant());
--> statement-breakpoint

-- tenants: own tenant, the partner's tenants, or tenants the current user belongs to.
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenants_access ON tenants
  USING (
    app_is_system()
    OR id = app_current_tenant()
    OR partner_id = app_current_partner()
    OR id IN (SELECT m.tenant_id FROM memberships m WHERE m.user_id = app_current_user())
  )
  WITH CHECK (app_is_system() OR id = app_current_tenant() OR partner_id = app_current_partner());
--> statement-breakpoint

-- partner_memberships: the partner sees its staff; a user sees their own partner roles.
ALTER TABLE partner_memberships ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE partner_memberships FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY partner_memberships_access ON partner_memberships
  USING (app_is_system() OR partner_id = app_current_partner() OR user_id = app_current_user())
  WITH CHECK (app_is_system() OR partner_id = app_current_partner());
--> statement-breakpoint

-- partners: readable by its staff, by its tenants (branding) and by users of its tenants.
ALTER TABLE partners ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE partners FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY partners_read ON partners FOR SELECT
  USING (
    app_is_system()
    OR id = app_current_partner()
    OR id IN (SELECT t.partner_id FROM tenants t)
    OR id IN (SELECT pm.partner_id FROM partner_memberships pm)
  );
--> statement-breakpoint
CREATE POLICY partners_write ON partners FOR ALL
  USING (app_is_system() OR id = app_current_partner())
  WITH CHECK (app_is_system() OR id = app_current_partner());
--> statement-breakpoint

-- roles: tenant only.
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE roles FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY roles_tenant ON roles
  USING (app_is_system() OR tenant_id = app_current_tenant())
  WITH CHECK (app_is_system() OR tenant_id = app_current_tenant());
--> statement-breakpoint

-- invitations: tenant, or the partner while provisioning one of its tenants.
ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE invitations FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY invitations_access ON invitations
  USING (
    app_is_system()
    OR tenant_id = app_current_tenant()
    OR tenant_id IN (SELECT t.id FROM tenants t WHERE t.partner_id = app_current_partner())
  )
  WITH CHECK (
    app_is_system()
    OR tenant_id = app_current_tenant()
    OR tenant_id IN (SELECT t.id FROM tenants t WHERE t.partner_id = app_current_partner())
  );
--> statement-breakpoint

-- support_access_grants: granted by the tenant, visible to the partner it was granted to.
ALTER TABLE support_access_grants ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE support_access_grants FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY support_access_grants_access ON support_access_grants
  USING (app_is_system() OR tenant_id = app_current_tenant() OR partner_id = app_current_partner())
  WITH CHECK (app_is_system() OR tenant_id = app_current_tenant());
--> statement-breakpoint

-- audit_logs: append-only. Only SELECT and INSERT policies exist, so UPDATE and DELETE
-- affect no rows for the application role.
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY audit_logs_read ON audit_logs FOR SELECT
  USING (app_is_system() OR tenant_id = app_current_tenant());
--> statement-breakpoint
CREATE POLICY audit_logs_append ON audit_logs FOR INSERT
  WITH CHECK (
    app_is_system()
    OR tenant_id = app_current_tenant()
    OR tenant_id IN (SELECT t.id FROM tenants t WHERE t.partner_id = app_current_partner())
  );

-- Context functions used by every Row Level Security policy.
-- See docs/adr/0002-mandanten-isolation-rls.md and packages/db/src/context.ts.
--
-- current_setting(name, true) returns NULL (or '' after a reset) when the setting is missing,
-- so a query without context matches no tenant and returns no rows.

CREATE OR REPLACE FUNCTION app_current_tenant() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT nullif(current_setting('app.tenant_id', true), '')::uuid $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_current_partner() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT nullif(current_setting('app.partner_id', true), '')::uuid $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_is_system() RETURNS boolean
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT coalesce(current_setting('app.system', true), '') = 'on' $$;

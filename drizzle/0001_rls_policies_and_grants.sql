-- Tenant isolation at the database, and the least-privilege grants for the runtime role.
--
-- Hand-written (drizzle-kit does not manage policies declared this way). Read docs/saas-architecture.md,
-- "Database isolation", before changing anything here.
--
-- How a request reaches these policies
--   The app connects as `climvia_app`: not a superuser, not the table owner, no BYPASSRLS, so every policy below
--   applies to it. Each tenant query runs inside a transaction that begins with
--       select set_config('app.user_id', <verified user id>, true), set_config('app.org_id', <verified org id>, true)
--   (`true` = transaction-local: the values vanish at COMMIT/ROLLBACK and can never leak to the next request on the
--   same pooled connection). The ids are put there by server code after it has verified the session and the
--   membership; they are never taken from the client. The policies then check membership AGAIN in the database, so
--   even a server bug that passes the wrong organization id cannot read or write another organization's rows.
--
-- Fail closed: with no context set, `app_current_user_id()` is NULL and every policy below is false.

-- ---------------------------------------------------------------------------------------------------------------
-- 1. Context readers and membership checks
-- ---------------------------------------------------------------------------------------------------------------

CREATE FUNCTION app_current_user_id() RETURNS text
LANGUAGE sql STABLE
AS $$ SELECT nullif(current_setting('app.user_id', true), '') $$;
--> statement-breakpoint

CREATE FUNCTION app_current_org_id() RETURNS uuid
LANGUAGE sql STABLE
AS $$ SELECT nullif(current_setting('app.org_id', true), '')::uuid $$;
--> statement-breakpoint

-- SECURITY DEFINER: these read `organization_memberships` as the table owner so the check does not recurse into that
-- table's own policies. They only ever answer about the CURRENT user (app_current_user_id()), never about an id the
-- caller supplies, so they cannot be used to probe other people's memberships.
CREATE FUNCTION app_is_member(org uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.organization_memberships m
    WHERE m.organization_id = org
      AND m.user_id = public.app_current_user_id()
      AND m.status = 'active'
  )
$$;
--> statement-breakpoint

CREATE FUNCTION app_has_role(org uuid, allowed text[]) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.organization_memberships m
    WHERE m.organization_id = org
      AND m.user_id = public.app_current_user_id()
      AND m.status = 'active'
      AND m.role = ANY (allowed)
  )
$$;
--> statement-breakpoint

-- True while an organization has no membership at all: the one moment its creator may add themselves as owner.
CREATE FUNCTION app_org_has_members(org uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$ SELECT EXISTS (SELECT 1 FROM public.organization_memberships m WHERE m.organization_id = org) $$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------------------------
-- 2. Membership changes that must not be plain UPDATE/DELETE
--    The runtime role has no UPDATE or DELETE on organization_memberships. These functions are the only way to
--    accept an invitation, change a role or remove a member, and they keep the organization from losing its last owner.
-- ---------------------------------------------------------------------------------------------------------------

CREATE FUNCTION app_accept_invitation(org uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF public.app_current_user_id() IS NULL THEN
    RAISE EXCEPTION 'Not signed in.' USING ERRCODE = '42501';
  END IF;
  UPDATE public.organization_memberships
     SET status = 'active'
   WHERE organization_id = org AND user_id = public.app_current_user_id() AND status = 'invited';
  RETURN FOUND;
END
$$;
--> statement-breakpoint

CREATE FUNCTION app_set_member_role(org uuid, target text, new_role text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  current_role_name text;
  owners integer;
BEGIN
  IF NOT public.app_has_role(org, ARRAY['owner']) THEN
    RAISE EXCEPTION 'Only an owner can change roles.' USING ERRCODE = '42501';
  END IF;
  IF new_role NOT IN ('owner', 'admin', 'member') THEN
    RAISE EXCEPTION 'Unknown role.' USING ERRCODE = '22023';
  END IF;
  SELECT role INTO current_role_name FROM public.organization_memberships
   WHERE organization_id = org AND user_id = target AND status = 'active';
  IF current_role_name IS NULL THEN
    RETURN false;
  END IF;
  IF current_role_name = 'owner' AND new_role <> 'owner' THEN
    SELECT count(*) INTO owners FROM public.organization_memberships
     WHERE organization_id = org AND role = 'owner' AND status = 'active';
    IF owners <= 1 THEN
      RAISE EXCEPTION 'An organization must keep at least one owner.' USING ERRCODE = '23514';
    END IF;
  END IF;
  UPDATE public.organization_memberships SET role = new_role
   WHERE organization_id = org AND user_id = target AND status = 'active';
  RETURN FOUND;
END
$$;
--> statement-breakpoint

CREATE FUNCTION app_remove_member(org uuid, target text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  caller text := public.app_current_user_id();
  target_role text;
  owners integer;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'Not signed in.' USING ERRCODE = '42501';
  END IF;
  SELECT role INTO target_role FROM public.organization_memberships WHERE organization_id = org AND user_id = target;
  IF target_role IS NULL THEN
    RETURN false;
  END IF;
  -- Leaving is always allowed; removing someone else needs authority over them.
  IF target <> caller THEN
    IF public.app_has_role(org, ARRAY['owner']) THEN
      NULL;
    ELSIF public.app_has_role(org, ARRAY['admin']) AND target_role = 'member' THEN
      NULL;
    ELSE
      RAISE EXCEPTION 'You cannot remove this member.' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF target_role = 'owner' THEN
    SELECT count(*) INTO owners FROM public.organization_memberships
     WHERE organization_id = org AND role = 'owner' AND status = 'active';
    IF owners <= 1 THEN
      RAISE EXCEPTION 'An organization must keep at least one owner.' USING ERRCODE = '23514';
    END IF;
  END IF;
  DELETE FROM public.organization_memberships WHERE organization_id = org AND user_id = target;
  RETURN FOUND;
END
$$;
--> statement-breakpoint

-- The default is that anybody may execute a function. Only the runtime role may.
REVOKE ALL ON FUNCTION app_current_user_id(), app_current_org_id(), app_is_member(uuid), app_has_role(uuid, text[]),
  app_org_has_members(uuid), app_accept_invitation(uuid), app_set_member_role(uuid, text, text), app_remove_member(uuid, text)
  FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_current_user_id(), app_current_org_id(), app_is_member(uuid), app_has_role(uuid, text[]),
  app_org_has_members(uuid), app_accept_invitation(uuid), app_set_member_role(uuid, text, text), app_remove_member(uuid, text)
  TO climvia_app;
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------------------------
-- 3. Row Level Security policies (RLS is already ENABLED on each table by the first migration)
--    No policy for a command means that command is denied to the runtime role.
-- ---------------------------------------------------------------------------------------------------------------

-- organizations: any member sees it; anyone signed in may create one (they become its owner in the same transaction);
-- only an owner or admin of the ACTIVE organization may change it; nobody deletes one through the app.
CREATE POLICY organizations_select ON organizations FOR SELECT TO climvia_app
  USING (app_is_member(id));
--> statement-breakpoint
-- A new organization can never be created with the sample-data flag set: only the seed (owner role) sets `fixture_set`.
CREATE POLICY organizations_insert ON organizations FOR INSERT TO climvia_app
  WITH CHECK (app_current_user_id() IS NOT NULL AND fixture_set IS NULL);
--> statement-breakpoint
CREATE POLICY organizations_update ON organizations FOR UPDATE TO climvia_app
  USING (id = app_current_org_id() AND app_has_role(id, ARRAY['owner', 'admin']))
  WITH CHECK (id = app_current_org_id() AND app_has_role(id, ARRAY['owner', 'admin']));
--> statement-breakpoint

-- organization_memberships: a person sees their own memberships and the other members of organizations they belong to.
-- Insert: the creator becomes the first owner (only while the organization has no members), or an owner/admin of the
-- active organization invites someone as admin or member (status 'invited'; owners are never invited).
CREATE POLICY memberships_select ON organization_memberships FOR SELECT TO climvia_app
  USING (user_id = app_current_user_id() OR app_is_member(organization_id));
--> statement-breakpoint
CREATE POLICY memberships_insert_first_owner ON organization_memberships FOR INSERT TO climvia_app
  WITH CHECK (
    user_id = app_current_user_id() AND role = 'owner' AND status = 'active'
    AND NOT app_org_has_members(organization_id)
  );
--> statement-breakpoint
CREATE POLICY memberships_insert_invite ON organization_memberships FOR INSERT TO climvia_app
  WITH CHECK (
    organization_id = app_current_org_id()
    AND app_has_role(organization_id, ARRAY['owner', 'admin'])
    AND role IN ('admin', 'member') AND status = 'invited'
  );
--> statement-breakpoint

-- organization_business_hours and sites: organization-owned data. Members of the ACTIVE organization read it; owners
-- and admins of the ACTIVE organization write it.
CREATE POLICY business_hours_select ON organization_business_hours FOR SELECT TO climvia_app
  USING (organization_id = app_current_org_id() AND app_is_member(organization_id));
--> statement-breakpoint
CREATE POLICY business_hours_write ON organization_business_hours FOR ALL TO climvia_app
  USING (organization_id = app_current_org_id() AND app_has_role(organization_id, ARRAY['owner', 'admin']))
  WITH CHECK (organization_id = app_current_org_id() AND app_has_role(organization_id, ARRAY['owner', 'admin']));
--> statement-breakpoint

CREATE POLICY sites_select ON sites FOR SELECT TO climvia_app
  USING (organization_id = app_current_org_id() AND app_is_member(organization_id));
--> statement-breakpoint
CREATE POLICY sites_insert ON sites FOR INSERT TO climvia_app
  WITH CHECK (organization_id = app_current_org_id() AND app_has_role(organization_id, ARRAY['owner', 'admin']));
--> statement-breakpoint
CREATE POLICY sites_update ON sites FOR UPDATE TO climvia_app
  USING (organization_id = app_current_org_id() AND app_has_role(organization_id, ARRAY['owner', 'admin']))
  WITH CHECK (organization_id = app_current_org_id() AND app_has_role(organization_id, ARRAY['owner', 'admin']));
--> statement-breakpoint

-- profiles: a person reads and writes only their own row.
CREATE POLICY profiles_select ON profiles FOR SELECT TO climvia_app
  USING (user_id = app_current_user_id());
--> statement-breakpoint
CREATE POLICY profiles_insert ON profiles FOR INSERT TO climvia_app
  WITH CHECK (user_id = app_current_user_id());
--> statement-breakpoint
CREATE POLICY profiles_update ON profiles FOR UPDATE TO climvia_app
  USING (user_id = app_current_user_id())
  WITH CHECK (user_id = app_current_user_id());
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------------------------
-- 4. Grants: least privilege for the runtime role. New tables get nothing until a migration grants it.
-- ---------------------------------------------------------------------------------------------------------------

GRANT USAGE ON SCHEMA public TO climvia_app;
--> statement-breakpoint

-- Authentication identity: Better Auth reads and writes these before anyone is signed in.
GRANT SELECT, INSERT, UPDATE, DELETE ON auth_user, auth_session, auth_account, auth_verification TO climvia_app;
--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE ON profiles TO climvia_app;
--> statement-breakpoint

-- Column-level: the runtime role can never UPDATE `fixture_set` (the transitional sample-data switch) or rewrite ids.
-- INSERT is granted on every column because Drizzle names every column in an INSERT (the ones it has no value for as
-- DEFAULT), and PostgreSQL checks the privilege for each named column. That includes `fixture_set`, so the INSERT policy
-- above refuses any row where it is not NULL.
GRANT SELECT ON organizations TO climvia_app;
--> statement-breakpoint
GRANT INSERT (id, name, slug, phone, email, address_line1, address_line2, city, state_region, postal_code, country,
  timezone, currency, date_format, time_format, logo_url, brand_accent, fixture_set, onboarding_completed_at,
  created_at, updated_at)
  ON organizations TO climvia_app;
--> statement-breakpoint
GRANT UPDATE (name, slug, phone, email, address_line1, address_line2, city, state_region, postal_code, country,
  timezone, currency, date_format, time_format, logo_url, brand_accent, onboarding_completed_at)
  ON organizations TO climvia_app;
--> statement-breakpoint

-- Memberships: read and invite (insert) only; changes go through the app_* functions above.
GRANT SELECT ON organization_memberships TO climvia_app;
--> statement-breakpoint
GRANT INSERT (id, organization_id, user_id, role, status, job_title, created_at, updated_at) ON organization_memberships TO climvia_app;
--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON organization_business_hours TO climvia_app;
--> statement-breakpoint

-- Sites cannot be deleted through the app (see the RESTRICT foreign key); organization_id is fixed once created.
GRANT SELECT, INSERT ON sites TO climvia_app;
--> statement-breakpoint
GRANT UPDATE (name, slug, status, selected_template_id, primary_domain) ON sites TO climvia_app;
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------------------------
-- 5. updated_at maintenance
-- ---------------------------------------------------------------------------------------------------------------

CREATE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER organizations_set_updated_at BEFORE UPDATE ON organizations FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER memberships_set_updated_at BEFORE UPDATE ON organization_memberships FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER business_hours_set_updated_at BEFORE UPDATE ON organization_business_hours FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER sites_set_updated_at BEFORE UPDATE ON sites FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER profiles_set_updated_at BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Tenant isolation, grants and integrity for the core business data: customers, properties, equipment, services and the team.
--
-- Hand-written, like 0001, and built from the SAME pieces: the transaction-local context (app.user_id / app.org_id) and the
-- SECURITY DEFINER membership checks defined there. Nothing here is a second isolation pattern.
--
-- The rules, per table family
--   customers, customer_notes, customer_properties, equipment
--       Members of the ACTIVE organization may read them. The runtime role may do NOTHING else: the product has no add,
--       edit or delete flow for them yet, so it gets no privilege to write. When one ships, its migration adds the grant
--       and the owner/admin policy together (no policy for a command means that command is denied).
--   services, team_roles, team_members, team_member_services, team_member_availability,
--   team_member_unavailable_periods, team_activity
--       Members of the ACTIVE organization read them; owners and admins of the ACTIVE organization write them. Team
--       roles and the permission matrix are product configuration, NOT the security boundary: only the SaaS role in
--       organization_memberships (owner / admin / member) decides who may write.
--
-- Cross-organization references are impossible rather than merely checked: every child reaches its parent through a
-- composite (organization_id, id) foreign key (see 0002), and PostgreSQL's referential checks run outside Row Level
-- Security, so they hold whoever is asking.

-- ---------------------------------------------------------------------------------------------------------------
-- 1. Row Level Security policies (RLS is already ENABLED on each table by 0002)
-- ---------------------------------------------------------------------------------------------------------------

CREATE POLICY customers_select ON customers FOR SELECT TO climvia_app
  USING (organization_id = app_current_org_id() AND app_is_member(organization_id));
--> statement-breakpoint
CREATE POLICY customer_notes_select ON customer_notes FOR SELECT TO climvia_app
  USING (organization_id = app_current_org_id() AND app_is_member(organization_id));
--> statement-breakpoint
CREATE POLICY customer_properties_select ON customer_properties FOR SELECT TO climvia_app
  USING (organization_id = app_current_org_id() AND app_is_member(organization_id));
--> statement-breakpoint
CREATE POLICY equipment_select ON equipment FOR SELECT TO climvia_app
  USING (organization_id = app_current_org_id() AND app_is_member(organization_id));
--> statement-breakpoint

CREATE POLICY services_select ON services FOR SELECT TO climvia_app
  USING (organization_id = app_current_org_id() AND app_is_member(organization_id));
--> statement-breakpoint
CREATE POLICY services_insert ON services FOR INSERT TO climvia_app
  WITH CHECK (organization_id = app_current_org_id() AND app_has_role(organization_id, ARRAY['owner', 'admin']));
--> statement-breakpoint
CREATE POLICY services_update ON services FOR UPDATE TO climvia_app
  USING (organization_id = app_current_org_id() AND app_has_role(organization_id, ARRAY['owner', 'admin']))
  WITH CHECK (organization_id = app_current_org_id() AND app_has_role(organization_id, ARRAY['owner', 'admin']));
--> statement-breakpoint

CREATE POLICY team_roles_select ON team_roles FOR SELECT TO climvia_app
  USING (organization_id = app_current_org_id() AND app_is_member(organization_id));
--> statement-breakpoint
CREATE POLICY team_roles_insert ON team_roles FOR INSERT TO climvia_app
  WITH CHECK (organization_id = app_current_org_id() AND app_has_role(organization_id, ARRAY['owner', 'admin']));
--> statement-breakpoint
CREATE POLICY team_roles_update ON team_roles FOR UPDATE TO climvia_app
  USING (organization_id = app_current_org_id() AND app_has_role(organization_id, ARRAY['owner', 'admin']))
  WITH CHECK (organization_id = app_current_org_id() AND app_has_role(organization_id, ARRAY['owner', 'admin']));
--> statement-breakpoint

CREATE POLICY team_members_select ON team_members FOR SELECT TO climvia_app
  USING (organization_id = app_current_org_id() AND app_is_member(organization_id));
--> statement-breakpoint
CREATE POLICY team_members_insert ON team_members FOR INSERT TO climvia_app
  WITH CHECK (organization_id = app_current_org_id() AND app_has_role(organization_id, ARRAY['owner', 'admin']));
--> statement-breakpoint
CREATE POLICY team_members_update ON team_members FOR UPDATE TO climvia_app
  USING (organization_id = app_current_org_id() AND app_has_role(organization_id, ARRAY['owner', 'admin']))
  WITH CHECK (organization_id = app_current_org_id() AND app_has_role(organization_id, ARRAY['owner', 'admin']));
--> statement-breakpoint

CREATE POLICY team_member_services_select ON team_member_services FOR SELECT TO climvia_app
  USING (organization_id = app_current_org_id() AND app_is_member(organization_id));
--> statement-breakpoint
CREATE POLICY team_member_services_insert ON team_member_services FOR INSERT TO climvia_app
  WITH CHECK (organization_id = app_current_org_id() AND app_has_role(organization_id, ARRAY['owner', 'admin']));
--> statement-breakpoint
CREATE POLICY team_member_services_delete ON team_member_services FOR DELETE TO climvia_app
  USING (organization_id = app_current_org_id() AND app_has_role(organization_id, ARRAY['owner', 'admin']));
--> statement-breakpoint

CREATE POLICY team_member_availability_select ON team_member_availability FOR SELECT TO climvia_app
  USING (organization_id = app_current_org_id() AND app_is_member(organization_id));
--> statement-breakpoint
CREATE POLICY team_member_availability_write ON team_member_availability FOR ALL TO climvia_app
  USING (organization_id = app_current_org_id() AND app_has_role(organization_id, ARRAY['owner', 'admin']))
  WITH CHECK (organization_id = app_current_org_id() AND app_has_role(organization_id, ARRAY['owner', 'admin']));
--> statement-breakpoint

CREATE POLICY team_member_unavailable_select ON team_member_unavailable_periods FOR SELECT TO climvia_app
  USING (organization_id = app_current_org_id() AND app_is_member(organization_id));
--> statement-breakpoint
CREATE POLICY team_member_unavailable_write ON team_member_unavailable_periods FOR ALL TO climvia_app
  USING (organization_id = app_current_org_id() AND app_has_role(organization_id, ARRAY['owner', 'admin']))
  WITH CHECK (organization_id = app_current_org_id() AND app_has_role(organization_id, ARRAY['owner', 'admin']));
--> statement-breakpoint

CREATE POLICY team_activity_select ON team_activity FOR SELECT TO climvia_app
  USING (organization_id = app_current_org_id() AND app_is_member(organization_id));
--> statement-breakpoint
CREATE POLICY team_activity_insert ON team_activity FOR INSERT TO climvia_app
  WITH CHECK (organization_id = app_current_org_id() AND app_has_role(organization_id, ARRAY['owner', 'admin']));
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------------------------
-- 2. Grants: least privilege for the runtime role. Ids and organization_id can never be rewritten.
-- ---------------------------------------------------------------------------------------------------------------

-- Read only: there is no flow that writes them.
GRANT SELECT ON customers, customer_notes, customer_properties, equipment TO climvia_app;
--> statement-breakpoint

-- INSERT is table-wide because Drizzle names every column in an INSERT (unset ones as DEFAULT); UPDATE is per column.
GRANT SELECT, INSERT ON services, team_roles, team_members, team_activity TO climvia_app;
--> statement-breakpoint
GRANT UPDATE (name, category, audience, description, internal_description, duration_minutes, pricing_model, price_amount,
  price_label, booking_method, visibility, is_active, display_order, intake, checklist)
  ON services TO climvia_app;
--> statement-breakpoint
GRANT UPDATE (name, description, permissions) ON team_roles TO climvia_app;
--> statement-breakpoint
-- user_id is deliberately not updatable: linking a login to a team member is not something the app does after creation.
GRANT UPDATE (name, job_title, title, role_id, email, phone, status, field_assignable, member_since, notes, service_mode,
  permission_override, availability_mode)
  ON team_members TO climvia_app;
--> statement-breakpoint

GRANT SELECT, INSERT, DELETE ON team_member_services TO climvia_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON team_member_availability, team_member_unavailable_periods TO climvia_app;
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------------------------
-- 3. Integrity the foreign keys cannot express
-- ---------------------------------------------------------------------------------------------------------------

-- A team member's Climvia login must be an active member of THE SAME organization. SECURITY DEFINER so the check sees
-- every membership regardless of who is writing.
CREATE FUNCTION team_member_login_must_belong() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.user_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.organization_memberships m
    WHERE m.organization_id = NEW.organization_id AND m.user_id = NEW.user_id AND m.status = 'active'
  ) THEN
    RAISE EXCEPTION 'A team member can only be linked to a login that belongs to the same organization'
      USING ERRCODE = '23514', CONSTRAINT = 'team_members_login_belongs';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER team_members_login_belongs BEFORE INSERT OR UPDATE OF user_id, organization_id ON team_members
  FOR EACH ROW EXECUTE FUNCTION team_member_login_must_belong();
--> statement-breakpoint

-- The protected (Owner) role cannot be renamed or have its permissions changed through the runtime role. Application code
-- also refuses; this is the backstop.
CREATE FUNCTION team_roles_protected_is_frozen() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.is_protected AND (NEW.permissions IS DISTINCT FROM OLD.permissions OR NEW.name IS DISTINCT FROM OLD.name) THEN
    RAISE EXCEPTION 'The protected role cannot be changed' USING ERRCODE = '23514', CONSTRAINT = 'team_roles_protected_frozen';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER team_roles_protected_frozen BEFORE UPDATE ON team_roles
  FOR EACH ROW EXECUTE FUNCTION team_roles_protected_is_frozen();
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------------------------
-- 4. updated_at maintenance (set_updated_at is defined in 0001)
-- ---------------------------------------------------------------------------------------------------------------

CREATE TRIGGER customers_set_updated_at BEFORE UPDATE ON customers FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER customer_properties_set_updated_at BEFORE UPDATE ON customer_properties FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER equipment_set_updated_at BEFORE UPDATE ON equipment FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER services_set_updated_at BEFORE UPDATE ON services FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER team_roles_set_updated_at BEFORE UPDATE ON team_roles FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER team_members_set_updated_at BEFORE UPDATE ON team_members FOR EACH ROW EXECUTE FUNCTION set_updated_at();

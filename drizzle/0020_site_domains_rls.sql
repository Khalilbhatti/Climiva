-- Custom domains: tenant isolation, grants, the transition guard, and the one narrow public path that finds a Site by its Host.
--
-- Hand-written, like 0013 and 0018, and built from the SAME pieces: the transaction-local context (app.user_id / app.org_id) and the
-- SECURITY DEFINER membership checks defined in 0001. 0019 created `site_domains` and removed the three columns that only RECORDED a domain
-- on a site (custom_domain, custom_domain_status, primary_domain).
--
-- The rules
--   site_domains
--       Members of the ACTIVE organization read. Owners and admins (the people who may manage the website) create a claim and move it
--       through its states. A claim is created PENDING and not main; the runtime role can change only its state, its timestamps and
--       whether it is main (column privileges), never its name, its Site, its token or who made it. It can only make the moves in
--       lib/domain-rules (pending -> verified -> active <-> disabled, and any of them -> removed); a removed claim never changes again.
--       Nothing is ever deleted: a removed claim is history, and frees the name for a new claim with a new token.
--       The verified/active/disabled/removed combinations of timestamps, "main means active" and the hostname's shape are CHECKs (0019);
--       one claim per name across every business, one main per site and one use of a token are unique indexes (0019).
--   sites
--       The columns that recorded a domain are gone, so the two guards that mentioned them are replaced below, unchanged otherwise.
--   public
--       app_public_domain(host) says which PUBLISHED site an ACTIVE name belongs to. Nothing else about a domain leaves the database.

-- ---------------------------------------------------------------------------------------------------------------
-- 1. The two guards on sites no longer mention a domain
-- ---------------------------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION sites_guard_insert() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_user = 'climvia_app' AND NEW.status <> 'draft' THEN
    RAISE EXCEPTION 'A new site starts private'
      USING ERRCODE = '42501', CONSTRAINT = 'sites_new_private';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION sites_guard_update() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.published_version_id IS NOT NULL AND NEW.published_version_id IS DISTINCT FROM OLD.published_version_id THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.site_versions v
       WHERE v.organization_id = NEW.organization_id AND v.site_id = NEW.id AND v.id = NEW.published_version_id AND v.status = 'published'
    ) THEN
      RAISE EXCEPTION 'A site can only be published from a published version of itself'
        USING ERRCODE = '23514', CONSTRAINT = 'sites_publish_target';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------------------------
-- 2. Row Level Security policies (RLS is already ENABLED on site_domains by 0019)
-- ---------------------------------------------------------------------------------------------------------------

CREATE POLICY site_domains_select ON site_domains FOR SELECT TO climvia_app
  USING (organization_id = app_current_org_id() AND app_is_member(organization_id));
--> statement-breakpoint
-- A claim starts pending, is not main, and has the revision a new row has; the person who makes it is the caller.
CREATE POLICY site_domains_insert ON site_domains FOR INSERT TO climvia_app
  WITH CHECK (
    organization_id = app_current_org_id() AND app_has_role(organization_id, ARRAY['owner', 'admin'])
    AND status = 'pending_verification' AND NOT is_primary AND revision = 1 AND created_by_user_id = app_current_user_id()
  );
--> statement-breakpoint
CREATE POLICY site_domains_update ON site_domains FOR UPDATE TO climvia_app
  USING (organization_id = app_current_org_id() AND app_has_role(organization_id, ARRAY['owner', 'admin']))
  WITH CHECK (organization_id = app_current_org_id() AND app_has_role(organization_id, ARRAY['owner', 'admin']));
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------------------------
-- 3. Grants (least privilege; every UPDATE is by column, and there is no DELETE)
-- ---------------------------------------------------------------------------------------------------------------

GRANT SELECT, INSERT ON site_domains TO climvia_app;
--> statement-breakpoint
GRANT UPDATE (status, is_primary, verified_at, activated_at, disabled_at, removed_at, last_checked_at) ON site_domains TO climvia_app;
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------------------------
-- 4. The transition guard and the revision
-- ---------------------------------------------------------------------------------------------------------------

-- The revision counts changes to the claim's STATE (its status, whether it is main, and its stamps), so a screen that is behind can be
-- refused; a DNS check that only stamps last_checked_at does not move it. The runtime role can make only the moves in lib/domain-rules, a
-- verification stamp never changes once set, and a removed claim is final.
CREATE FUNCTION site_domains_guard_update() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF (NEW.status, NEW.is_primary, NEW.verified_at, NEW.activated_at, NEW.disabled_at, NEW.removed_at)
     IS DISTINCT FROM (OLD.status, OLD.is_primary, OLD.verified_at, OLD.activated_at, OLD.disabled_at, OLD.removed_at) THEN
    NEW.revision := OLD.revision + 1;
  END IF;
  NEW.updated_at := now();
  IF current_user = 'climvia_app' THEN
    IF OLD.status = 'removed' THEN
      RAISE EXCEPTION 'A removed domain cannot be changed: claim it again'
        USING ERRCODE = '23514', CONSTRAINT = 'site_domains_removed_final';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
         (OLD.status = 'pending_verification' AND NEW.status IN ('verified', 'removed'))
      OR (OLD.status = 'verified' AND NEW.status IN ('active', 'removed'))
      OR (OLD.status = 'active' AND NEW.status IN ('disabled', 'removed'))
      OR (OLD.status = 'disabled' AND NEW.status IN ('active', 'removed'))
    ) THEN
      RAISE EXCEPTION 'A domain cannot move from % to %', OLD.status, NEW.status
        USING ERRCODE = '23514', CONSTRAINT = 'site_domains_transition';
    END IF;
    IF OLD.verified_at IS NOT NULL AND NEW.verified_at IS DISTINCT FROM OLD.verified_at THEN
      RAISE EXCEPTION 'When a domain was verified does not change'
        USING ERRCODE = '23514', CONSTRAINT = 'site_domains_verified_final';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER site_domains_guard_update BEFORE UPDATE ON site_domains FOR EACH ROW EXECUTE FUNCTION site_domains_guard_update();
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------------------------
-- 5. The public path: which published site does this name belong to?
-- ---------------------------------------------------------------------------------------------------------------

-- Same philosophy as the other public functions (0013, 0018): SECURITY DEFINER, a fixed search_path, executable by the runtime role and by
-- nobody else, and a projection built field by field. The caller passes the NORMALIZED name (lib/hostname); nothing else is matched, so a
-- spelling that is not stored finds nothing. It answers only for an ACTIVE claim whose site is PUBLISHED, and returns the site's public
-- identity and the name its pages should call themselves (the site's main active domain, or this one): no token, no organization id, no
-- other claim, no status, no draft.
CREATE FUNCTION app_public_domain(p_hostname text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  d public.site_domains%ROWTYPE;
  s public.sites%ROWTYPE;
  main_host text;
BEGIN
  IF p_hostname IS NULL OR char_length(p_hostname) > 231 THEN RETURN NULL; END IF;
  SELECT * INTO d FROM public.site_domains WHERE hostname = p_hostname AND status = 'active';
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO s FROM public.sites WHERE organization_id = d.organization_id AND id = d.site_id;
  IF NOT FOUND OR s.status <> 'published' OR s.published_version_id IS NULL THEN RETURN NULL; END IF;
  SELECT hostname INTO main_host FROM public.site_domains WHERE site_id = s.id AND is_primary AND status = 'active';
  RETURN jsonb_build_object('platformSlug', s.platform_slug, 'canonicalHost', coalesce(main_host, d.hostname));
END
$$;
--> statement-breakpoint

-- The name a published site's pages should call themselves when they are opened through the platform address: its main ACTIVE custom domain,
-- or NULL. (Used for the canonical address in a page's metadata.)
CREATE FUNCTION app_public_site_domain(p_platform_slug text) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  main_host text;
BEGIN
  IF p_platform_slug IS NULL OR char_length(p_platform_slug) > 63 THEN RETURN NULL; END IF;
  SELECT d.hostname INTO main_host
    FROM public.sites s
    JOIN public.site_domains d ON d.organization_id = s.organization_id AND d.site_id = s.id
   WHERE s.platform_slug = lower(p_platform_slug) AND s.status = 'published' AND s.published_version_id IS NOT NULL
     AND d.is_primary AND d.status = 'active';
  RETURN main_host;
END
$$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION app_public_domain(text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_public_site_domain(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_public_domain(text) TO climvia_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_public_site_domain(text) TO climvia_app;

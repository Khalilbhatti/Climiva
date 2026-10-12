-- Tenant isolation, grants, integrity and the narrow PUBLIC read/write paths for Sites, Site Versions, Pages, Sections and the Marketplace.
--
-- Hand-written, like 0001, 0003, 0005, 0007, 0009 and 0011, and built from the SAME pieces: the transaction-local context
-- (app.user_id / app.org_id) and the SECURITY DEFINER membership checks defined in 0001. Nothing here is a second isolation pattern for
-- the workspace. The public paths (section 6) are the one new thing, and they are deliberately small.
--
-- The rules, per table
--   site_templates
--       Application-owned. The runtime role reads the ACTIVE ones and can change nothing; a template is written by a migration.
--   sites
--       Members of the ACTIVE organization read; owners and admins create a site and change its name, status, template, published
--       pointer and domain record. Its identity (organization, slug, platform slug, whether it is the primary site) is fixed once created.
--       A site is published exactly when it points at a PUBLISHED version of itself.
--   site_versions
--       Members read. Owners and admins create the Draft, and change a DRAFT's theme, settings and template. A PUBLISHED version is a
--       snapshot: it may be created only in the transaction that is publishing the site (the site row was touched in it, and the
--       publisher is the caller), and after that nothing changes it, by anyone, through any column.
--   site_pages, site_sections
--       Members read. Owners and admins add, change and remove them while their version is the Draft. A page or section of a Published
--       version is written only in the publishing transaction (same rule) and never changed afterwards.
--   marketplace_listings, marketplace_listing_services
--       Members read. Owners and admins create the listing, change its configuration and select the Services it shows. Nobody deletes a
--       listing.
--
-- Cross-organization references are impossible rather than merely checked: every child reaches its parent through a composite
-- (organization_id, ...) foreign key (see 0012), and PostgreSQL's referential checks run outside Row Level Security.

-- ---------------------------------------------------------------------------------------------------------------
-- 1. A site's public address defaults safely
-- ---------------------------------------------------------------------------------------------------------------

-- The application names a site's public address when it creates one. A site made any other way still gets a valid, unique one: the
-- organization's address (and the site's own, unless it is "main") plus six random characters.
CREATE FUNCTION sites_default_platform_slug() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  base text;
BEGIN
  IF NEW.platform_slug IS NULL THEN
    SELECT regexp_replace(left(o.slug || CASE WHEN NEW.slug = 'main' THEN '' ELSE '-' || NEW.slug END, 54), '-+$', '')
      INTO base
      FROM public.organizations o
     WHERE o.id = NEW.organization_id;
    IF base IS NOT NULL THEN
      NEW.platform_slug := base || '-' || substr(md5(random()::text || clock_timestamp()::text), 1, 6);
    END IF;
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER sites_default_platform_slug BEFORE INSERT ON sites FOR EACH ROW EXECUTE FUNCTION sites_default_platform_slug();
--> statement-breakpoint

-- A site is created private: the application cannot create one already verified for a custom domain, or already published.
CREATE FUNCTION sites_guard_insert() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_user = 'climvia_app' AND (NEW.custom_domain_status = 'verified' OR NEW.status <> 'draft') THEN
    RAISE EXCEPTION 'A new site starts private, with any custom domain unverified'
      USING ERRCODE = '42501', CONSTRAINT = 'sites_new_private';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER sites_guard_insert BEFORE INSERT ON sites FOR EACH ROW EXECUTE FUNCTION sites_guard_insert();
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------------------------
-- 2. Row Level Security policies (RLS is already ENABLED on each table by 0012)
-- ---------------------------------------------------------------------------------------------------------------

CREATE POLICY site_templates_select ON site_templates FOR SELECT TO climvia_app
  USING (is_active);
--> statement-breakpoint

CREATE POLICY site_versions_select ON site_versions FOR SELECT TO climvia_app
  USING (organization_id = app_current_org_id() AND app_is_member(organization_id));
--> statement-breakpoint
-- A Draft is created by an owner or admin at any time (there is at most one per site). A PUBLISHED version only in the transaction that
-- publishes the site: the site row was just updated in it (updated_at = now() is the transaction's own start time), and the caller is the
-- publisher.
CREATE POLICY site_versions_insert ON site_versions FOR INSERT TO climvia_app
  WITH CHECK (
    organization_id = app_current_org_id() AND app_has_role(organization_id, ARRAY['owner', 'admin'])
    AND (
      (status = 'draft' AND published_at IS NULL AND published_by_user_id IS NULL)
      OR (
        status = 'published' AND published_by_user_id = app_current_user_id()
        AND EXISTS (SELECT 1 FROM sites s WHERE s.organization_id = site_versions.organization_id AND s.id = site_versions.site_id AND s.updated_at = now())
      )
    )
  );
--> statement-breakpoint
CREATE POLICY site_versions_update ON site_versions FOR UPDATE TO climvia_app
  USING (organization_id = app_current_org_id() AND app_has_role(organization_id, ARRAY['owner', 'admin']) AND status = 'draft')
  WITH CHECK (organization_id = app_current_org_id() AND app_has_role(organization_id, ARRAY['owner', 'admin']) AND status = 'draft');
--> statement-breakpoint

CREATE POLICY site_pages_select ON site_pages FOR SELECT TO climvia_app
  USING (organization_id = app_current_org_id() AND app_is_member(organization_id));
--> statement-breakpoint
CREATE POLICY site_pages_insert ON site_pages FOR INSERT TO climvia_app
  WITH CHECK (
    organization_id = app_current_org_id() AND app_has_role(organization_id, ARRAY['owner', 'admin'])
    AND EXISTS (
      SELECT 1 FROM site_versions v
       WHERE v.organization_id = site_pages.organization_id AND v.id = site_pages.site_version_id
         AND (
           v.status = 'draft'
           OR (v.status = 'published' AND EXISTS (SELECT 1 FROM sites s WHERE s.organization_id = v.organization_id AND s.id = v.site_id AND s.updated_at = now()))
         )
    )
  );
--> statement-breakpoint
CREATE POLICY site_pages_update ON site_pages FOR UPDATE TO climvia_app
  USING (
    organization_id = app_current_org_id() AND app_has_role(organization_id, ARRAY['owner', 'admin'])
    AND EXISTS (SELECT 1 FROM site_versions v WHERE v.organization_id = site_pages.organization_id AND v.id = site_pages.site_version_id AND v.status = 'draft')
  )
  WITH CHECK (
    organization_id = app_current_org_id() AND app_has_role(organization_id, ARRAY['owner', 'admin'])
    AND EXISTS (SELECT 1 FROM site_versions v WHERE v.organization_id = site_pages.organization_id AND v.id = site_pages.site_version_id AND v.status = 'draft')
  );
--> statement-breakpoint
CREATE POLICY site_pages_delete ON site_pages FOR DELETE TO climvia_app
  USING (
    organization_id = app_current_org_id() AND app_has_role(organization_id, ARRAY['owner', 'admin'])
    AND EXISTS (SELECT 1 FROM site_versions v WHERE v.organization_id = site_pages.organization_id AND v.id = site_pages.site_version_id AND v.status = 'draft')
  );
--> statement-breakpoint

CREATE POLICY site_sections_select ON site_sections FOR SELECT TO climvia_app
  USING (organization_id = app_current_org_id() AND app_is_member(organization_id));
--> statement-breakpoint
CREATE POLICY site_sections_insert ON site_sections FOR INSERT TO climvia_app
  WITH CHECK (
    organization_id = app_current_org_id() AND app_has_role(organization_id, ARRAY['owner', 'admin'])
    AND EXISTS (
      SELECT 1 FROM site_versions v
       WHERE v.organization_id = site_sections.organization_id AND v.id = site_sections.site_version_id
         AND (
           v.status = 'draft'
           OR (v.status = 'published' AND EXISTS (SELECT 1 FROM sites s WHERE s.organization_id = v.organization_id AND s.id = v.site_id AND s.updated_at = now()))
         )
    )
  );
--> statement-breakpoint
CREATE POLICY site_sections_update ON site_sections FOR UPDATE TO climvia_app
  USING (
    organization_id = app_current_org_id() AND app_has_role(organization_id, ARRAY['owner', 'admin'])
    AND EXISTS (SELECT 1 FROM site_versions v WHERE v.organization_id = site_sections.organization_id AND v.id = site_sections.site_version_id AND v.status = 'draft')
  )
  WITH CHECK (
    organization_id = app_current_org_id() AND app_has_role(organization_id, ARRAY['owner', 'admin'])
    AND EXISTS (SELECT 1 FROM site_versions v WHERE v.organization_id = site_sections.organization_id AND v.id = site_sections.site_version_id AND v.status = 'draft')
  );
--> statement-breakpoint
CREATE POLICY site_sections_delete ON site_sections FOR DELETE TO climvia_app
  USING (
    organization_id = app_current_org_id() AND app_has_role(organization_id, ARRAY['owner', 'admin'])
    AND EXISTS (SELECT 1 FROM site_versions v WHERE v.organization_id = site_sections.organization_id AND v.id = site_sections.site_version_id AND v.status = 'draft')
  );
--> statement-breakpoint

CREATE POLICY marketplace_listings_select ON marketplace_listings FOR SELECT TO climvia_app
  USING (organization_id = app_current_org_id() AND app_is_member(organization_id));
--> statement-breakpoint
CREATE POLICY marketplace_listings_insert ON marketplace_listings FOR INSERT TO climvia_app
  WITH CHECK (organization_id = app_current_org_id() AND app_has_role(organization_id, ARRAY['owner', 'admin']));
--> statement-breakpoint
CREATE POLICY marketplace_listings_update ON marketplace_listings FOR UPDATE TO climvia_app
  USING (organization_id = app_current_org_id() AND app_has_role(organization_id, ARRAY['owner', 'admin']))
  WITH CHECK (organization_id = app_current_org_id() AND app_has_role(organization_id, ARRAY['owner', 'admin']));
--> statement-breakpoint

CREATE POLICY marketplace_listing_services_select ON marketplace_listing_services FOR SELECT TO climvia_app
  USING (organization_id = app_current_org_id() AND app_is_member(organization_id));
--> statement-breakpoint
CREATE POLICY marketplace_listing_services_insert ON marketplace_listing_services FOR INSERT TO climvia_app
  WITH CHECK (organization_id = app_current_org_id() AND app_has_role(organization_id, ARRAY['owner', 'admin']));
--> statement-breakpoint
CREATE POLICY marketplace_listing_services_update ON marketplace_listing_services FOR UPDATE TO climvia_app
  USING (organization_id = app_current_org_id() AND app_has_role(organization_id, ARRAY['owner', 'admin']))
  WITH CHECK (organization_id = app_current_org_id() AND app_has_role(organization_id, ARRAY['owner', 'admin']));
--> statement-breakpoint
CREATE POLICY marketplace_listing_services_delete ON marketplace_listing_services FOR DELETE TO climvia_app
  USING (organization_id = app_current_org_id() AND app_has_role(organization_id, ARRAY['owner', 'admin']));
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------------------------
-- 3. Grants (least privilege; every UPDATE is by column)
-- ---------------------------------------------------------------------------------------------------------------

GRANT SELECT ON site_templates TO climvia_app;
--> statement-breakpoint

-- A site's slug is fixed once created (its public address is platform_slug, which no column privilege lets anyone change).
REVOKE UPDATE (slug) ON sites FROM climvia_app;
--> statement-breakpoint
GRANT UPDATE (published_version_id, custom_domain, custom_domain_status) ON sites TO climvia_app;
--> statement-breakpoint

GRANT SELECT, INSERT ON site_versions TO climvia_app;
--> statement-breakpoint
-- Only a Draft's content: never the identity, number, status or publication stamp of a version.
GRANT UPDATE (theme, settings, template_id) ON site_versions TO climvia_app;
--> statement-breakpoint

GRANT SELECT, INSERT, DELETE ON site_pages, site_sections TO climvia_app;
--> statement-breakpoint
GRANT UPDATE (title, slug, sort_order, is_visible) ON site_pages TO climvia_app;
--> statement-breakpoint
GRANT UPDATE (label, variant, props, sort_order, is_visible) ON site_sections TO climvia_app;
--> statement-breakpoint

GRANT SELECT, INSERT ON marketplace_listings TO climvia_app;
--> statement-breakpoint
GRANT UPDATE (status, description, cover, show_phone, show_email, show_address, show_hours, show_website, action_book, action_website, action_contact, published_at) ON marketplace_listings TO climvia_app;
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON marketplace_listing_services TO climvia_app;
--> statement-breakpoint
GRANT UPDATE (sort_order) ON marketplace_listing_services TO climvia_app;
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------------------------
-- 4. Integrity the constraints cannot express
-- ---------------------------------------------------------------------------------------------------------------

-- A site can point only at a PUBLISHED version of itself (the composite foreign key already makes it a version of this site).
CREATE FUNCTION sites_guard_update() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- A custom domain is a claim until it is verified, and the application cannot verify one: that belongs to the domain-routing phase and
  -- to the owner role. The runtime role can record a domain and change which address is main, never mark it verified.
  IF NEW.custom_domain_status = 'verified' AND NEW.custom_domain_status IS DISTINCT FROM OLD.custom_domain_status AND current_user = 'climvia_app' THEN
    RAISE EXCEPTION 'A domain is verified by the platform, not by the application'
      USING ERRCODE = '42501', CONSTRAINT = 'sites_domain_verified';
  END IF;
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
CREATE TRIGGER sites_guard_update BEFORE UPDATE ON sites FOR EACH ROW EXECUTE FUNCTION sites_guard_update();
--> statement-breakpoint

-- A Published version is a snapshot: nothing about it changes, through any column, for anyone (the owner role included). A Draft keeps its
-- identity: it never becomes a published version by update (Publish makes a NEW row), and its number and site never change.
CREATE FUNCTION site_versions_guard_update() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status = 'published' THEN
    RAISE EXCEPTION 'A published version is a snapshot and cannot be changed'
      USING ERRCODE = '23514', CONSTRAINT = 'site_published_final';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status OR NEW.version_number IS DISTINCT FROM OLD.version_number
     OR NEW.site_id IS DISTINCT FROM OLD.site_id OR NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
    RAISE EXCEPTION 'A draft keeps its identity: publish it to make a new published version'
      USING ERRCODE = '23514', CONSTRAINT = 'site_versions_identity';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER site_versions_guard_update BEFORE UPDATE ON site_versions FOR EACH ROW EXECUTE FUNCTION site_versions_guard_update();
--> statement-breakpoint

-- The pages and sections of a Published version are snapshots too.
CREATE FUNCTION site_content_guard_update() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.site_versions v WHERE v.id = OLD.site_version_id AND v.status = 'published') THEN
    RAISE EXCEPTION 'A published version is a snapshot and cannot be changed'
      USING ERRCODE = '23514', CONSTRAINT = 'site_published_final';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER site_pages_guard_update BEFORE UPDATE ON site_pages FOR EACH ROW EXECUTE FUNCTION site_content_guard_update();
--> statement-breakpoint
CREATE TRIGGER site_sections_guard_update BEFORE UPDATE ON site_sections FOR EACH ROW EXECUTE FUNCTION site_content_guard_update();
--> statement-breakpoint

-- A listing is published once (published_at is the first time); after that it is published or hidden, and never a draft again.
CREATE FUNCTION marketplace_listings_guard() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'draft' THEN
      NEW.published_at := NULL;
    ELSE
      NEW.published_at := COALESCE(NEW.published_at, now());
    END IF;
  ELSE
    IF OLD.status <> 'draft' AND NEW.status = 'draft' THEN
      RAISE EXCEPTION 'A listing that has been published cannot go back to a draft: hide it instead'
        USING ERRCODE = '23514', CONSTRAINT = 'marketplace_listings_no_draft';
    END IF;
    IF NEW.status <> 'draft' THEN
      NEW.published_at := COALESCE(OLD.published_at, NEW.published_at, now());
    END IF;
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER marketplace_listings_guard BEFORE INSERT OR UPDATE ON marketplace_listings FOR EACH ROW EXECUTE FUNCTION marketplace_listings_guard();
--> statement-breakpoint

-- A listing can only SELECT a Service the business offers publicly: active and not internal.
CREATE FUNCTION marketplace_listing_services_guard() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.services s
     WHERE s.organization_id = NEW.organization_id AND s.id = NEW.service_id AND s.is_active AND s.visibility <> 'internal'
  ) THEN
    RAISE EXCEPTION 'Only an active, public Service can be shown on a listing'
      USING ERRCODE = '23514', CONSTRAINT = 'marketplace_listing_services_public';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER marketplace_listing_services_guard BEFORE INSERT ON marketplace_listing_services FOR EACH ROW EXECUTE FUNCTION marketplace_listing_services_guard();
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------------------------
-- 5. updated_at maintenance (set_updated_at is defined in 0001)
-- ---------------------------------------------------------------------------------------------------------------

CREATE TRIGGER site_templates_set_updated_at BEFORE UPDATE ON site_templates FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER site_versions_set_updated_at BEFORE UPDATE ON site_versions FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER site_pages_set_updated_at BEFORE UPDATE ON site_pages FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER site_sections_set_updated_at BEFORE UPDATE ON site_sections FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER marketplace_listings_set_updated_at BEFORE UPDATE ON marketplace_listings FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------------------------
-- 6. The PUBLIC paths
--
-- A visitor has no session and no organization. Public pages therefore do not go through the tenant policies above (they require a
-- signed-in member of the active organization). They go through the functions below, which are the only way a request without a
-- membership reads or writes tenant rows, and are deliberately small:
--
--   * SECURITY DEFINER, with a fixed search_path, executable by the runtime role and by nobody else (REVOKE ... FROM PUBLIC).
--   * They take a PUBLIC IDENTITY (a site's platform slug, a listing's public slug), resolve it to the owning organization INSIDE the
--     function, and never accept an organization id.
--   * They return a PROJECTION: only what the public may see, built field by field (never a row, never `*`). They read only a site's
--     PUBLISHED version, only its visible pages and sections, only the organization's public contact fields, only active non-internal
--     Services. Customers, jobs, money, team permissions, analytics and unpublished drafts are not reachable from them.
--   * The one write, a public booking, creates one booking of source "Website" for a Service that belongs to the site's organization and
--     is bookable online, and returns only its number and status.
-- ---------------------------------------------------------------------------------------------------------------

-- The allocation of a business's next number, WITHOUT the membership check: for the definer functions below (a visitor has no
-- membership). It is not granted to anyone. app_next_number (0005) keeps its check and now calls it.
CREATE FUNCTION app_take_number(p_org uuid, p_kind text) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  allocated integer;
BEGIN
  -- A business starts at 1001. Existing businesses get their counter the first time they need one.
  INSERT INTO public.organization_sequences (organization_id, kind, next_value) VALUES (p_org, p_kind, 1001)
    ON CONFLICT (organization_id, kind) DO NOTHING;
  UPDATE public.organization_sequences
     SET next_value = next_value + 1, updated_at = now()
   WHERE organization_id = p_org AND kind = p_kind
  RETURNING next_value - 1 INTO allocated;
  RETURN allocated;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_take_number(uuid, text) FROM PUBLIC;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app_next_number(p_kind text) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  org uuid := public.app_current_org_id();
BEGIN
  IF org IS NULL OR NOT public.app_has_role(org, ARRAY['owner', 'admin']) THEN
    RAISE EXCEPTION 'Not allowed to allocate numbers for this organization' USING ERRCODE = '42501';
  END IF;
  RETURN public.app_take_number(org, p_kind);
END
$$;
--> statement-breakpoint

-- A published site, as a visitor sees it: the site, the organization's public contact fields and hours, the published version's
-- theme and settings, the visible pages (for the navigation), the requested page with its visible sections, and the public Services.
-- NULL when the site does not exist or is not published. The requested page is NULL when the site has no visible page at that address.
CREATE FUNCTION app_public_site(p_platform_slug text, p_page_slug text DEFAULT '') RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  s public.sites%ROWTYPE;
  v public.site_versions%ROWTYPE;
  o public.organizations%ROWTYPE;
  pg public.site_pages%ROWTYPE;
BEGIN
  IF p_platform_slug IS NULL OR char_length(p_platform_slug) > 63 THEN RETURN NULL; END IF;
  SELECT * INTO s FROM public.sites WHERE platform_slug = lower(p_platform_slug);
  IF NOT FOUND OR s.status <> 'published' OR s.published_version_id IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO v FROM public.site_versions WHERE id = s.published_version_id AND organization_id = s.organization_id AND site_id = s.id AND status = 'published';
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO o FROM public.organizations WHERE id = s.organization_id;
  SELECT * INTO pg FROM public.site_pages WHERE site_version_id = v.id AND slug = coalesce(p_page_slug, '') AND is_visible;

  RETURN jsonb_build_object(
    'site', jsonb_build_object('name', s.name, 'platformSlug', s.platform_slug),
    'organization', jsonb_build_object(
      'name', o.name, 'phone', o.phone, 'email', o.email,
      'street', o.address_line1, 'city', o.city, 'state', o.state_region, 'postalCode', o.postal_code,
      'timeZone', o.timezone, 'dateFormat', o.date_format, 'timeFormat', o.time_format
    ),
    'hours', (
      SELECT coalesce(jsonb_agg(jsonb_build_object('day', h.day_of_week, 'open', h.is_open, 'opensAt', to_char(h.opens_at, 'HH24:MI'), 'closesAt', to_char(h.closes_at, 'HH24:MI')) ORDER BY h.day_of_week), '[]'::jsonb)
        FROM public.organization_business_hours h WHERE h.organization_id = o.id
    ),
    -- The sample business keeps the product's fixed day for its dated records (a transitional flag; see src/server/workspace.ts).
    'fixedClock', coalesce(o.fixture_set = 'apex-demo', false),
    'version', jsonb_build_object('number', v.version_number, 'theme', v.theme, 'settings', v.settings, 'publishedAt', v.published_at),
    'pages', (
      SELECT coalesce(jsonb_agg(jsonb_build_object('key', p.page_key, 'title', p.title, 'slug', p.slug, 'type', p.page_type, 'sortOrder', p.sort_order) ORDER BY p.sort_order), '[]'::jsonb)
        FROM public.site_pages p WHERE p.site_version_id = v.id AND p.is_visible
    ),
    'page', CASE WHEN pg.id IS NULL THEN NULL ELSE jsonb_build_object(
      'key', pg.page_key, 'title', pg.title, 'slug', pg.slug, 'type', pg.page_type,
      'sections', (
        SELECT coalesce(jsonb_agg(jsonb_build_object('key', c.section_key, 'label', c.label, 'type', c.type, 'variant', c.variant, 'props', c.props, 'sortOrder', c.sort_order) ORDER BY c.sort_order), '[]'::jsonb)
          FROM public.site_sections c WHERE c.page_id = pg.id AND c.is_visible
      )
    ) END,
    'services', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'slug', sv.slug, 'name', sv.name, 'category', sv.category, 'description', sv.description, 'durationMinutes', sv.duration_minutes,
        'pricingModel', sv.pricing_model, 'priceAmount', sv.price_amount, 'priceLabel', sv.price_label, 'bookingMethod', sv.booking_method,
        'visibility', sv.visibility, 'displayOrder', sv.display_order, 'intake', sv.intake
      ) ORDER BY sv.display_order), '[]'::jsonb)
        FROM public.services sv WHERE sv.organization_id = o.id AND sv.is_active AND sv.visibility <> 'internal'
    )
  );
END
$$;
--> statement-breakpoint

-- A published Marketplace listing, as the directory shows it. Only what the listing switches on is returned: a contact detail the
-- business turned off is not in the answer at all. NULL unless the listing is published.
CREATE FUNCTION app_public_listing(p_public_slug text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  l public.marketplace_listings%ROWTYPE;
  o public.organizations%ROWTYPE;
  site_slug text;
  site_version uuid;
BEGIN
  IF p_public_slug IS NULL OR char_length(p_public_slug) > 63 THEN RETURN NULL; END IF;
  SELECT * INTO l FROM public.marketplace_listings WHERE public_slug = lower(p_public_slug);
  IF NOT FOUND OR l.status <> 'published' THEN RETURN NULL; END IF;
  SELECT * INTO o FROM public.organizations WHERE id = l.organization_id;
  -- The primary site's public identity, only while that site is published: the "View website" and "Book service" actions lead there.
  SELECT s.platform_slug, s.published_version_id INTO site_slug, site_version FROM public.sites s
   WHERE s.organization_id = l.organization_id AND s.is_primary AND s.status = 'published' AND s.published_version_id IS NOT NULL;

  RETURN jsonb_build_object(
    'listing', jsonb_build_object(
      'publicSlug', l.public_slug, 'description', l.description, 'cover', l.cover,
      'actions', jsonb_build_object('book', l.action_book, 'website', l.action_website, 'contact', l.action_contact),
      'contact', jsonb_build_object('phone', l.show_phone, 'email', l.show_email, 'address', l.show_address, 'hours', l.show_hours, 'website', l.show_website)
    ),
    'organization', jsonb_build_object(
      'name', o.name,
      'phone', CASE WHEN l.show_phone THEN o.phone END,
      'email', CASE WHEN l.show_email THEN o.email END,
      'street', CASE WHEN l.show_address THEN o.address_line1 END,
      'city', CASE WHEN l.show_address THEN o.city END,
      'state', CASE WHEN l.show_address THEN o.state_region END,
      'postalCode', CASE WHEN l.show_address THEN o.postal_code END,
      'timeFormat', o.time_format
    ),
    'hours', CASE WHEN l.show_hours THEN (
      SELECT coalesce(jsonb_agg(jsonb_build_object('day', h.day_of_week, 'open', h.is_open, 'opensAt', to_char(h.opens_at, 'HH24:MI'), 'closesAt', to_char(h.closes_at, 'HH24:MI')) ORDER BY h.day_of_week), '[]'::jsonb)
        FROM public.organization_business_hours h WHERE h.organization_id = o.id
    ) ELSE '[]'::jsonb END,
    'siteSlug', site_slug,
    -- The visible pages of that published site (their addresses and kinds), so the actions can lead to its Booking and Contact pages.
    'sitePages', CASE WHEN site_slug IS NULL THEN '[]'::jsonb ELSE (
      SELECT coalesce(jsonb_agg(jsonb_build_object('key', p.page_key, 'title', p.title, 'slug', p.slug, 'type', p.page_type) ORDER BY p.sort_order), '[]'::jsonb)
        FROM public.site_pages p WHERE p.site_version_id = site_version AND p.is_visible
    ) END,
    'services', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'slug', sv.slug, 'name', sv.name, 'description', sv.description, 'durationMinutes', sv.duration_minutes,
        'pricingModel', sv.pricing_model, 'priceAmount', sv.price_amount, 'priceLabel', sv.price_label, 'bookingMethod', sv.booking_method, 'visibility', sv.visibility
      ) ORDER BY ls.sort_order, sv.display_order), '[]'::jsonb)
        FROM public.marketplace_listing_services ls
        JOIN public.services sv ON sv.organization_id = ls.organization_id AND sv.id = ls.service_id
       WHERE ls.listing_id = l.id AND sv.is_active AND sv.visibility <> 'internal'
    )
  );
END
$$;
--> statement-breakpoint

-- A booking made from a published site's Booking page. The organization is the SITE's, found here; the Service must be one of that
-- organization's, active and bookable online; the number is that organization's next. A second submission with the same key (or the
-- same person asking for the same Service at the same time) finds the first booking instead of making another.
-- Whether the date and time are valid for the business (its hours, its clock) is checked by the application before this is called, with the
-- same rules the workspace uses; the status follows the Service's booking method exactly as for any other customer-facing booking.
CREATE FUNCTION app_public_create_booking(
  p_platform_slug text, p_service_slug text, p_submission_key text,
  p_service_date date, p_start time, p_end time,
  p_contact_name text, p_contact_phone text, p_contact_email text, p_contact_address text, p_note text,
  p_intake_system_type text, p_intake_reported_issue text,
  -- The instant the request arrived, on the business's clock (the sample business keeps the product's fixed day). Defaults to now.
  p_received_at timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  s public.sites%ROWTYPE;
  sv public.services%ROWTYPE;
  existing public.bookings%ROWTYPE;
  new_status text;
  new_number integer;
BEGIN
  IF p_platform_slug IS NULL OR char_length(p_platform_slug) > 63 THEN RETURN jsonb_build_object('ok', false, 'reason', 'site'); END IF;
  SELECT * INTO s FROM public.sites WHERE platform_slug = lower(p_platform_slug);
  IF NOT FOUND OR s.status <> 'published' OR s.published_version_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'site'); END IF;

  SELECT * INTO sv FROM public.services
   WHERE organization_id = s.organization_id AND slug = p_service_slug AND is_active AND visibility = 'public-booking';
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'service'); END IF;

  IF p_contact_name IS NULL OR char_length(btrim(p_contact_name)) NOT BETWEEN 1 AND 80
     OR p_contact_email IS NULL OR char_length(p_contact_email) > 200
     OR p_contact_phone IS NULL OR char_length(p_contact_phone) > 60
     OR p_contact_address IS NULL OR char_length(btrim(p_contact_address)) NOT BETWEEN 1 AND 300
     OR p_service_date IS NULL OR p_start IS NULL OR p_end IS NULL OR p_end <= p_start THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'details');
  END IF;

  -- The same submission again: the booking it already made.
  IF p_submission_key IS NOT NULL THEN
    SELECT * INTO existing FROM public.bookings WHERE organization_id = s.organization_id AND submission_key = p_submission_key;
    IF FOUND THEN RETURN jsonb_build_object('ok', true, 'duplicate', true, 'number', existing.number, 'status', existing.status); END IF;
  END IF;
  -- The same person asking for the same Service at the same time again.
  SELECT * INTO existing FROM public.bookings
   WHERE organization_id = s.organization_id AND source = 'Website' AND service_id = sv.id AND service_date = p_service_date AND start_time = p_start
     AND lower(contact_email) = lower(p_contact_email) AND status IN ('pending', 'confirmed')
   ORDER BY number LIMIT 1;
  IF FOUND THEN RETURN jsonb_build_object('ok', true, 'duplicate', true, 'number', existing.number, 'status', existing.status); END IF;

  new_status := CASE sv.booking_method WHEN 'instant' THEN 'confirmed' ELSE 'pending' END;
  -- A business's counter starts at 1001 and walks past numbers already stored (a baseline booking may hold one).
  LOOP
    new_number := public.app_take_number(s.organization_id, 'booking');
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.bookings b WHERE b.organization_id = s.organization_id AND b.number = new_number);
  END LOOP;

  INSERT INTO public.bookings (
    organization_id, number, customer_id, property_id, service_id, assignee_id, contact_name, contact_phone, contact_email, contact_address,
    source, status, service_date, start_time, end_time, note, intake_system_type, intake_reported_issue, submission_key, received_at, confirmed_at
  ) VALUES (
    s.organization_id, new_number, NULL, NULL, sv.id, NULL, btrim(p_contact_name), btrim(p_contact_phone), btrim(p_contact_email), btrim(p_contact_address),
    'Website', new_status, p_service_date, p_start, p_end, nullif(btrim(coalesce(p_note, '')), ''), nullif(btrim(coalesce(p_intake_system_type, '')), ''),
    nullif(btrim(coalesce(p_intake_reported_issue, '')), ''), p_submission_key, coalesce(p_received_at, now()), CASE WHEN new_status = 'confirmed' THEN coalesce(p_received_at, now()) END
  );
  RETURN jsonb_build_object('ok', true, 'duplicate', false, 'number', new_number, 'status', new_status);
END
$$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION app_public_site(text, text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_public_listing(text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_public_create_booking(text, text, text, date, time, time, text, text, text, text, text, text, text, timestamptz) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_public_site(text, text) TO climvia_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_public_listing(text) TO climvia_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_public_create_booking(text, text, text, date, time, time, text, text, text, text, text, text, text, timestamptz) TO climvia_app;
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------------------------
-- 7. The application's default site template
--
-- Written here, by a migration, never by a tenant. e2e/website-database.spec.ts keeps this row identical to src/db/default-template.ts.
-- ---------------------------------------------------------------------------------------------------------------

INSERT INTO site_templates (key, name, category, description, schema_version, definition, is_active)
VALUES ('climvia-starter', 'Climvia starter', 'hvac', 'A five-page website for an HVAC business: Home, Services, About, Contact and Booking.', 1, $template${
  "schema": 1,
  "theme": {
    "schema": 1,
    "accent": null,
    "radius": "medium",
    "density": "comfortable",
    "headingFont": "inter",
    "bodyFont": "inter"
  },
  "settings": {
    "serviceDisplay": {
      "order": [],
      "hidden": []
    }
  },
  "pages": [
    {
      "key": "home",
      "title": "Home",
      "slug": "",
      "type": "home",
      "visible": true,
      "sections": [
        {
          "key": "hero",
          "label": "Hero",
          "type": "hero",
          "variant": "default",
          "visible": true,
          "props": {
            "headline": "Heating & cooling service when you need it.",
            "supportingText": "Book HVAC maintenance, diagnostics, and repair services with {{business.name}}.",
            "primaryCta": "Book service",
            "secondaryCta": "View services",
            "alignment": "left"
          }
        },
        {
          "key": "services",
          "label": "Services",
          "type": "service_list",
          "variant": "cards",
          "visible": true,
          "props": {
            "heading": "Our HVAC Services",
            "supportingText": "Choose a service to view details and booking options."
          }
        },
        {
          "key": "why",
          "label": "Why choose us",
          "type": "feature_list",
          "variant": "icons",
          "visible": true,
          "props": {
            "heading": "Why customers choose {{business.name}}",
            "item1Title": "Clear service options",
            "item1Text": "See each service with its price and booking option before you book.",
            "item2Title": "Convenient online booking",
            "item2Text": "Book or request a time online in a few steps, from any device.",
            "item3Title": "Local customer support",
            "item3Text": "Heating and cooling specialists serving {{business.location}}."
          }
        },
        {
          "key": "hours",
          "label": "Business hours",
          "type": "business_hours",
          "variant": "card",
          "visible": true,
          "props": {}
        },
        {
          "key": "contact",
          "label": "Contact",
          "type": "contact_details",
          "variant": "card",
          "visible": true,
          "props": {}
        },
        {
          "key": "bookingCta",
          "label": "Booking CTA",
          "type": "call_to_action",
          "variant": "default",
          "visible": true,
          "props": {
            "heading": "Ready to schedule service?",
            "supportingText": "Select an inspection, heating repair, or seasonal cooling tune-up online in a few minutes.",
            "buttonLabel": "Book service"
          }
        }
      ]
    },
    {
      "key": "services",
      "title": "Services",
      "slug": "services",
      "type": "services",
      "visible": true,
      "sections": [
        {
          "key": "intro",
          "label": "Page intro",
          "type": "page_intro",
          "variant": "default",
          "visible": true,
          "props": {
            "heading": "HVAC Services",
            "supportingText": "Explore maintenance, diagnostics, repair, and installation Services available from {{business.name}}.",
            "alignment": "left"
          }
        },
        {
          "key": "catalog",
          "label": "Service catalog",
          "type": "service_list",
          "variant": "catalog",
          "visible": true,
          "props": {}
        },
        {
          "key": "bookingCta",
          "label": "Booking CTA",
          "type": "call_to_action",
          "variant": "default",
          "visible": true,
          "props": {
            "heading": "Need HVAC service?",
            "supportingText": "Choose a service and request a time that works for you.",
            "buttonLabel": "Book service"
          }
        }
      ]
    },
    {
      "key": "about",
      "title": "About",
      "slug": "about",
      "type": "content",
      "visible": true,
      "sections": [
        {
          "key": "intro",
          "label": "Page intro",
          "type": "page_intro",
          "variant": "default",
          "visible": true,
          "props": {
            "heading": "About {{business.name}}",
            "supportingText": "Learn more about our approach to HVAC service and the customers we serve.",
            "alignment": "left"
          }
        },
        {
          "key": "business",
          "label": "Our business",
          "type": "rich_text",
          "variant": "default",
          "visible": true,
          "props": {
            "heading": "Our business",
            "body": "{{business.name}} provides HVAC maintenance, diagnostics, repair, and installation services in {{business.location}}."
          }
        },
        {
          "key": "values",
          "label": "What matters to us",
          "type": "feature_list",
          "variant": "plain",
          "visible": true,
          "props": {
            "heading": "What matters to us",
            "supportingText": "Core standards applied across every scheduled appointment.",
            "item1Title": "Clear communication",
            "item1Text": "Explain service options and next steps clearly.",
            "item2Title": "Practical scheduling",
            "item2Text": "Make it easy for customers to request or book service.",
            "item3Title": "Organized service records",
            "item3Text": "Keep property and service information connected throughout the customer experience."
          }
        },
        {
          "key": "details",
          "label": "Business details",
          "type": "business_details",
          "variant": "default",
          "visible": true,
          "props": {}
        },
        {
          "key": "bookingCta",
          "label": "Booking CTA",
          "type": "call_to_action",
          "variant": "default",
          "visible": true,
          "props": {
            "heading": "Need HVAC service?",
            "supportingText": "View available Services and request a time that works for you.",
            "buttonLabel": "Book service"
          }
        }
      ]
    },
    {
      "key": "contact",
      "title": "Contact",
      "slug": "contact",
      "type": "contact",
      "visible": true,
      "sections": [
        {
          "key": "intro",
          "label": "Page intro",
          "type": "page_intro",
          "variant": "default",
          "visible": true,
          "props": {
            "heading": "Contact {{business.name}}",
            "supportingText": "Get in touch with our team or book an HVAC Service online.",
            "alignment": "left"
          }
        },
        {
          "key": "details",
          "label": "Contact details",
          "type": "contact_details",
          "variant": "page",
          "visible": true,
          "props": {}
        },
        {
          "key": "hours",
          "label": "Business hours",
          "type": "business_hours",
          "variant": "page",
          "visible": true,
          "props": {}
        },
        {
          "key": "form",
          "label": "Contact form",
          "type": "contact_form",
          "variant": "default",
          "visible": true,
          "props": {
            "heading": "Send us a message",
            "supportingText": "Share your question and your contact details, and the business can follow up with you."
          }
        },
        {
          "key": "bookingCta",
          "label": "Booking CTA",
          "type": "call_to_action",
          "variant": "default",
          "visible": true,
          "props": {
            "heading": "Ready to schedule HVAC service?",
            "supportingText": "Choose a Service and request or book a time using the available booking options.",
            "buttonLabel": "Book service"
          }
        }
      ]
    },
    {
      "key": "booking",
      "title": "Booking",
      "slug": "booking",
      "type": "booking",
      "visible": true,
      "sections": [
        {
          "key": "intro",
          "label": "Page intro",
          "type": "page_intro",
          "variant": "default",
          "visible": true,
          "props": {
            "heading": "Book HVAC service",
            "supportingText": "Choose a Service and follow the available booking options to request or schedule your visit.",
            "alignment": "left"
          }
        },
        {
          "key": "experience",
          "label": "Booking experience",
          "type": "service_list",
          "variant": "booking",
          "visible": true,
          "props": {}
        },
        {
          "key": "alternative",
          "label": "Contact alternative",
          "type": "contact_details",
          "variant": "callout",
          "visible": true,
          "props": {
            "heading": "Prefer to contact us first?",
            "supportingText": "You can contact {{business.name}} if you have questions before booking."
          }
        }
      ]
    }
  ]
}$template$::jsonb, true);

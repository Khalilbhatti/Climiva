-- Tenant isolation, grants, integrity and the one narrow PUBLIC read path for Assets and Organization Branding.
--
-- Hand-written, like 0001, 0003, 0005, 0007, 0009, 0011 and 0013, and built from the SAME pieces: the transaction-local context
-- (app.user_id / app.org_id) and the SECURITY DEFINER membership checks defined in 0001. Nothing here is a second isolation pattern.
--
-- The rules, per table
--   assets
--       Members of the ACTIVE organization read the metadata (never the bytes: those are in object storage). Owners and admins add an Asset,
--       and only as PENDING and only as themselves; after that the runtime role can move its status along the lifecycle
--       (pending -> ready | failed, ready | failed -> deleted) and change nothing else, by any column. Nobody deletes a row: there is no
--       DELETE grant and no DELETE policy, so history and the audit trail stay.
--   organization_branding
--       Members read; owners and admins create the row and change the logo and the accent. A logo can only be one of the organization's
--       OWN READY logo Assets: the composite foreign key (0017) makes another business's Asset impossible, and a trigger refuses a pending,
--       failed or deleted one. An Asset that is a business's current logo cannot be deleted.
--
-- Public access is never a policy on these tables. A visitor has no session, so it goes through app_public_asset, which finds the Asset only
-- while it is READY, a LOGO, and the logo its business has chosen; and the logo reaches the public Site and listing through the two
-- projections below, which return an Asset id (never a storage key).

-- ---------------------------------------------------------------------------------------------------------------
-- 1. Row Level Security policies (RLS is already ENABLED on each table by 0017)
-- ---------------------------------------------------------------------------------------------------------------

CREATE POLICY assets_select ON assets FOR SELECT TO climvia_app
  USING (organization_id = app_current_org_id() AND app_is_member(organization_id));
--> statement-breakpoint
CREATE POLICY assets_insert ON assets FOR INSERT TO climvia_app
  WITH CHECK (
    organization_id = app_current_org_id() AND app_has_role(organization_id, ARRAY['owner', 'admin'])
    AND status = 'pending' AND created_by_user_id = app_current_user_id()
  );
--> statement-breakpoint
CREATE POLICY assets_update ON assets FOR UPDATE TO climvia_app
  USING (organization_id = app_current_org_id() AND app_has_role(organization_id, ARRAY['owner', 'admin']))
  WITH CHECK (organization_id = app_current_org_id() AND app_has_role(organization_id, ARRAY['owner', 'admin']));
--> statement-breakpoint

CREATE POLICY organization_branding_select ON organization_branding FOR SELECT TO climvia_app
  USING (organization_id = app_current_org_id() AND app_is_member(organization_id));
--> statement-breakpoint
CREATE POLICY organization_branding_insert ON organization_branding FOR INSERT TO climvia_app
  WITH CHECK (organization_id = app_current_org_id() AND app_has_role(organization_id, ARRAY['owner', 'admin']));
--> statement-breakpoint
CREATE POLICY organization_branding_update ON organization_branding FOR UPDATE TO climvia_app
  USING (organization_id = app_current_org_id() AND app_has_role(organization_id, ARRAY['owner', 'admin']))
  WITH CHECK (organization_id = app_current_org_id() AND app_has_role(organization_id, ARRAY['owner', 'admin']));
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------------------------
-- 2. Grants (least privilege; every UPDATE is by column; nothing is deleted)
-- ---------------------------------------------------------------------------------------------------------------

GRANT SELECT ON assets TO climvia_app;
--> statement-breakpoint
-- INSERT names every column because Drizzle does (the ones it has no value for as DEFAULT); the policy above fixes the status and the author.
GRANT INSERT (id, organization_id, purpose, storage_driver, storage_key, original_filename, media_type, byte_size, width, height, checksum,
  status, created_by_user_id, created_at, ready_at, deleted_at) ON assets TO climvia_app;
--> statement-breakpoint
GRANT UPDATE (status, ready_at, deleted_at) ON assets TO climvia_app;
--> statement-breakpoint

GRANT SELECT ON organization_branding TO climvia_app;
--> statement-breakpoint
GRANT INSERT (organization_id, logo_asset_id, accent, created_at, updated_at) ON organization_branding TO climvia_app;
--> statement-breakpoint
GRANT UPDATE (logo_asset_id, accent) ON organization_branding TO climvia_app;
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------------------------
-- 3. Integrity the constraints cannot express
-- ---------------------------------------------------------------------------------------------------------------

CREATE TRIGGER organization_branding_set_updated_at BEFORE UPDATE ON organization_branding FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint

-- An Asset's identity and content never change, and its status only moves forward. The runtime role is held to this (the seed and the
-- migrations, which run as the owner, may repair a row); an Asset that is a business's current logo cannot be deleted.
CREATE FUNCTION assets_guard_update() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_user = 'climvia_app' THEN
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.organization_id IS DISTINCT FROM OLD.organization_id OR NEW.purpose IS DISTINCT FROM OLD.purpose
       OR NEW.storage_driver IS DISTINCT FROM OLD.storage_driver OR NEW.storage_key IS DISTINCT FROM OLD.storage_key
       OR NEW.original_filename IS DISTINCT FROM OLD.original_filename OR NEW.media_type IS DISTINCT FROM OLD.media_type
       OR NEW.byte_size IS DISTINCT FROM OLD.byte_size OR NEW.width IS DISTINCT FROM OLD.width OR NEW.height IS DISTINCT FROM OLD.height
       OR NEW.checksum IS DISTINCT FROM OLD.checksum OR NEW.created_by_user_id IS DISTINCT FROM OLD.created_by_user_id
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'An asset''s identity and content never change'
        USING ERRCODE = '42501', CONSTRAINT = 'assets_immutable';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
      (OLD.status = 'pending' AND NEW.status IN ('ready', 'failed')) OR (OLD.status IN ('ready', 'failed') AND NEW.status = 'deleted')
    ) THEN
      RAISE EXCEPTION 'An asset cannot go from % to %', OLD.status, NEW.status
        USING ERRCODE = '23514', CONSTRAINT = 'assets_status_transition';
    END IF;
  END IF;
  IF NEW.status = 'deleted' AND OLD.status <> 'deleted' AND EXISTS (
    SELECT 1 FROM public.organization_branding b WHERE b.organization_id = OLD.organization_id AND b.logo_asset_id = OLD.id
  ) THEN
    RAISE EXCEPTION 'An asset that is a business''s logo cannot be deleted'
      USING ERRCODE = '23503', CONSTRAINT = 'assets_in_use';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER assets_guard_update BEFORE UPDATE ON assets FOR EACH ROW EXECUTE FUNCTION assets_guard_update();
--> statement-breakpoint

-- The logo is one of the business's OWN READY LOGO Assets. (The composite foreign key already makes it one of the business's own; whether it
-- is a ready logo is a fact about another table's row, which a CHECK cannot read.)
CREATE FUNCTION organization_branding_guard() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.logo_asset_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.logo_asset_id IS DISTINCT FROM OLD.logo_asset_id) THEN
    PERFORM 1 FROM public.assets a
     WHERE a.organization_id = NEW.organization_id AND a.id = NEW.logo_asset_id AND a.purpose = 'logo' AND a.status = 'ready';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'A logo must be one of the business''s own ready logo files'
        USING ERRCODE = '23514', CONSTRAINT = 'organization_branding_logo_ready';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER organization_branding_guard BEFORE INSERT OR UPDATE ON organization_branding FOR EACH ROW EXECUTE FUNCTION organization_branding_guard();
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------------------------
-- 4. The public paths
-- ---------------------------------------------------------------------------------------------------------------

-- A business's logo, as a visitor's request for it needs it: where the bytes are and what they are. The same rules as every public path:
-- SECURITY DEFINER with a fixed search_path, executable by the runtime role and by nobody else, and an answer built field by field. The Asset
-- is found only while it is READY, a LOGO, and the logo its business has CHOSEN: a logo that was replaced or removed, a pending or failed
-- upload and every other Asset answer NULL, whatever their id. The storage key is returned to the server that fetches the bytes and goes no further.
CREATE FUNCTION app_public_asset(p_asset_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_asset public.assets%ROWTYPE;
BEGIN
  IF p_asset_id IS NULL THEN RETURN NULL; END IF;
  SELECT a.* INTO v_asset
    FROM public.assets a
    JOIN public.organization_branding b ON b.organization_id = a.organization_id AND b.logo_asset_id = a.id
   WHERE a.id = p_asset_id AND a.status = 'ready' AND a.purpose = 'logo';
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN jsonb_build_object(
    'storageDriver', v_asset.storage_driver, 'storageKey', v_asset.storage_key,
    'mediaType', v_asset.media_type, 'byteSize', v_asset.byte_size, 'checksum', v_asset.checksum
  );
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_public_asset(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_public_asset(uuid) TO climvia_app;
--> statement-breakpoint

-- The two public projections gain one field, the business's logo as an Asset id (or null). Everything else in them is exactly as in 0013.
-- The logo is the business's identity, so it is read when the page is drawn: changing it needs no Publish, and it is not copied into a
-- Site Version.
CREATE OR REPLACE FUNCTION app_public_site(p_platform_slug text, p_page_slug text DEFAULT '') RETURNS jsonb
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
      'timeZone', o.timezone, 'dateFormat', o.date_format, 'timeFormat', o.time_format,
      'logo', (
        SELECT jsonb_build_object('assetId', a.id)
          FROM public.organization_branding b
          JOIN public.assets a ON a.organization_id = b.organization_id AND a.id = b.logo_asset_id
         WHERE b.organization_id = o.id AND a.status = 'ready' AND a.purpose = 'logo'
      )
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
CREATE OR REPLACE FUNCTION app_public_listing(p_public_slug text) RETURNS jsonb
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
      'timeFormat', o.time_format,
      'logo', (
        SELECT jsonb_build_object('assetId', a.id)
          FROM public.organization_branding b
          JOIN public.assets a ON a.organization_id = b.organization_id AND a.id = b.logo_asset_id
         WHERE b.organization_id = o.id AND a.status = 'ready' AND a.purpose = 'logo'
      )
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
REVOKE ALL ON FUNCTION app_public_site(text, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_public_site(text, text) TO climvia_app;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_public_listing(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_public_listing(text) TO climvia_app;

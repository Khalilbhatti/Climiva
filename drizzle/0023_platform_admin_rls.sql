-- Platform administration: who may operate Climvia itself, and the narrow functions through which the application does it.
--
-- Hand-written (drizzle-kit does not manage functions, triggers or grants). Read docs/saas-architecture.md, "Platform administration", first.
--
-- The model, in one paragraph
--   A platform administrator is a row in `platform_admins` with no `revoked_at`. That is a different thing from a business's owner, admin or
--   member (`organization_memberships`): neither implies the other. The runtime role `climvia_app` has NO privilege on `platform_admins`,
--   `platform_listing_moderation` or `platform_audit_events` (and RLS is on with no policy, so a mistaken GRANT would still read nothing).
--   The application reaches them only through the SECURITY DEFINER functions below. Every one of them starts with `app_platform_guard()`,
--   which raises unless the CURRENT user (`app.user_id`, set by server code after it verified the session, exactly as the tenant policies
--   trust it) has an active `platform_admins` row. There is no function that writes `platform_admins`: authority is granted and revoked only
--   with the command-line tool, connected as the owner. There is no generic "read as the owner" function: each function returns a fixed
--   shape of non-secret columns (never a password hash, session token, verification token or DNS ownership token).
--
-- What this does NOT defend against: code that can run arbitrary SQL as `climvia_app` can set `app.user_id` to anything, for these functions
-- and for the tenant policies alike. The boundary is "the server sets the identity after verifying it", which the specs hold in the source.

-- ---------------------------------------------------------------------------------------------------------------
-- 1. Who is a platform administrator, and the guard every platform function starts with
-- ---------------------------------------------------------------------------------------------------------------

-- Answers only about the CURRENT user, never about an id the caller supplies, so it cannot be used to probe who else is an administrator.
CREATE FUNCTION app_is_platform_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT public.app_current_user_id() IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM public.platform_admins a
        WHERE a.user_id = public.app_current_user_id() AND a.revoked_at IS NULL AND a.role = 'super_admin'
     )
$$;
--> statement-breakpoint

-- Internal: not granted to the runtime role. The other functions call it first.
CREATE FUNCTION app_platform_guard() RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.app_is_platform_admin() THEN
    RAISE EXCEPTION 'Platform authority is required.' USING ERRCODE = '42501';
  END IF;
END
$$;
--> statement-breakpoint

-- Internal: a LIKE pattern for "contains this text", with the text's own % _ and \ taken literally. NULL for no search.
CREATE FUNCTION app_platform_like(p_search text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN p_search IS NULL OR btrim(p_search) = '' THEN NULL
    ELSE '%' || replace(replace(replace(left(btrim(p_search), 100), '\', '\\'), '%', '\%'), '_', '\_') || '%'
  END
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------------------------
-- 2. The append-only audit trail
-- ---------------------------------------------------------------------------------------------------------------

CREATE FUNCTION platform_audit_events_refuse() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'The platform audit trail is append-only.' USING ERRCODE = '42501';
END
$$;
--> statement-breakpoint

CREATE TRIGGER platform_audit_events_no_change
  BEFORE UPDATE OR DELETE ON platform_audit_events
  FOR EACH ROW EXECUTE FUNCTION platform_audit_events_refuse();
--> statement-breakpoint

CREATE TRIGGER platform_audit_events_no_truncate
  BEFORE TRUNCATE ON platform_audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION platform_audit_events_refuse();
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------------------------
-- 3. Reading across businesses (administrators only)
-- ---------------------------------------------------------------------------------------------------------------

CREATE FUNCTION app_platform_overview() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.app_platform_guard();
  RETURN jsonb_build_object(
    'organizations', (SELECT count(*) FROM public.organizations),
    'users', (SELECT count(*) FROM public.auth_user),
    'activeMemberships', (SELECT count(*) FROM public.organization_memberships WHERE status = 'active'),
    'sites', (SELECT count(*) FROM public.sites),
    'publishedSites', (SELECT count(*) FROM public.sites WHERE status = 'published' AND published_version_id IS NOT NULL),
    'listings', (SELECT count(*) FROM public.marketplace_listings),
    'publishedListings', (SELECT count(*) FROM public.marketplace_listings WHERE status = 'published'),
    'suspendedListings', (SELECT count(*) FROM public.platform_listing_moderation WHERE state = 'suspended'),
    'bookings', (SELECT count(*) FROM public.bookings),
    'reviews', (SELECT count(*) FROM public.reviews)
  );
END
$$;
--> statement-breakpoint

CREATE FUNCTION app_platform_organizations(p_search text, p_limit integer, p_offset integer) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  pattern text := public.app_platform_like(p_search);
  lim integer := least(greatest(coalesce(p_limit, 25), 1), 100);
  off integer := greatest(coalesce(p_offset, 0), 0);
  total bigint;
  found_rows jsonb;
BEGIN
  PERFORM public.app_platform_guard();
  SELECT count(*) INTO total FROM public.organizations o WHERE pattern IS NULL OR o.name ILIKE pattern;
  SELECT coalesce(jsonb_agg(x.j ORDER BY x.created_at DESC, x.name, x.id), '[]'::jsonb) INTO found_rows FROM (
    SELECT o.id, o.created_at, o.name, jsonb_build_object(
      'id', o.id,
      'name', o.name,
      'slug', o.slug,
      'createdAt', o.created_at,
      'memberships', (SELECT count(*) FROM public.organization_memberships m WHERE m.organization_id = o.id AND m.status = 'active'),
      'owners', (SELECT count(*) FROM public.organization_memberships m WHERE m.organization_id = o.id AND m.status = 'active' AND m.role = 'owner'),
      'services', (SELECT count(*) FROM public.services sv WHERE sv.organization_id = o.id),
      'sites', (SELECT count(*) FROM public.sites s WHERE s.organization_id = o.id),
      'publishedSites', (SELECT count(*) FROM public.sites s WHERE s.organization_id = o.id AND s.status = 'published' AND s.published_version_id IS NOT NULL),
      'listingStatus', (SELECT l.status FROM public.marketplace_listings l WHERE l.organization_id = o.id),
      'listingModeration', (SELECT coalesce(pm.state, 'allowed') FROM public.marketplace_listings l LEFT JOIN public.platform_listing_moderation pm ON pm.listing_id = l.id WHERE l.organization_id = o.id)
    ) AS j
    FROM public.organizations o
    WHERE pattern IS NULL OR o.name ILIKE pattern
    ORDER BY o.created_at DESC, o.name, o.id
    LIMIT lim OFFSET off
  ) x;
  RETURN jsonb_build_object('total', total, 'rows', found_rows);
END
$$;
--> statement-breakpoint

CREATE FUNCTION app_platform_organization(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  o public.organizations%ROWTYPE;
BEGIN
  PERFORM public.app_platform_guard();
  IF p_id IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO o FROM public.organizations WHERE id = p_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN jsonb_build_object(
    'profile', jsonb_build_object(
      'id', o.id, 'name', o.name, 'slug', o.slug, 'phone', o.phone, 'email', o.email,
      'addressLine1', o.address_line1, 'addressLine2', o.address_line2, 'city', o.city, 'stateRegion', o.state_region,
      'postalCode', o.postal_code, 'country', o.country, 'timezone', o.timezone, 'currency', o.currency,
      'createdAt', o.created_at, 'onboardingCompletedAt', o.onboarding_completed_at
    ),
    'memberships', (
      SELECT coalesce(jsonb_agg(jsonb_build_object('userId', u.id, 'name', u.name, 'email', u.email, 'role', m.role, 'status', m.status, 'since', m.created_at)
                               ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, m.created_at, u.id), '[]'::jsonb)
        FROM public.organization_memberships m JOIN public.auth_user u ON u.id = m.user_id
       WHERE m.organization_id = o.id
    ),
    'services', (
      SELECT coalesce(jsonb_agg(jsonb_build_object('id', sv.id, 'name', sv.name, 'isActive', sv.is_active, 'visibility', sv.visibility, 'bookingMethod', sv.booking_method) ORDER BY sv.display_order, sv.id), '[]'::jsonb)
        FROM (SELECT * FROM public.services WHERE organization_id = o.id ORDER BY display_order, id LIMIT 100) sv
    ),
    'sites', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', s.id, 'name', s.name, 'platformSlug', s.platform_slug, 'isPrimary', s.is_primary, 'status', s.status,
        'published', (s.status = 'published' AND s.published_version_id IS NOT NULL)
      ) ORDER BY s.is_primary DESC, s.created_at, s.id), '[]'::jsonb)
        FROM public.sites s WHERE s.organization_id = o.id
    ),
    'listing', (
      SELECT jsonb_build_object(
        'id', l.id, 'publicSlug', l.public_slug, 'status', l.status, 'publishedAt', l.published_at,
        'selectedServices', (SELECT count(*) FROM public.marketplace_listing_services ls WHERE ls.listing_id = l.id),
        'moderation', jsonb_build_object('state', coalesce(pm.state, 'allowed'), 'reason', pm.reason, 'decidedAt', pm.decided_at)
      )
        FROM public.marketplace_listings l LEFT JOIN public.platform_listing_moderation pm ON pm.listing_id = l.id
       WHERE l.organization_id = o.id
    ),
    'counts', jsonb_build_object(
      'customers', (SELECT count(*) FROM public.customers WHERE organization_id = o.id),
      'bookings', (SELECT count(*) FROM public.bookings WHERE organization_id = o.id),
      'jobs', (SELECT count(*) FROM public.jobs WHERE organization_id = o.id),
      'quotes', (SELECT count(*) FROM public.quotes WHERE organization_id = o.id),
      'invoices', (SELECT count(*) FROM public.invoices WHERE organization_id = o.id),
      'payments', (SELECT count(*) FROM public.payments WHERE organization_id = o.id),
      'reviews', (SELECT count(*) FROM public.reviews WHERE organization_id = o.id),
      'domains', (SELECT count(*) FROM public.site_domains WHERE organization_id = o.id AND status <> 'removed')
    )
  );
END
$$;
--> statement-breakpoint

CREATE FUNCTION app_platform_users(p_search text, p_limit integer, p_offset integer) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  pattern text := public.app_platform_like(p_search);
  lim integer := least(greatest(coalesce(p_limit, 25), 1), 100);
  off integer := greatest(coalesce(p_offset, 0), 0);
  total bigint;
  found_rows jsonb;
BEGIN
  PERFORM public.app_platform_guard();
  SELECT count(*) INTO total FROM public.auth_user u WHERE pattern IS NULL OR u.name ILIKE pattern OR u.email ILIKE pattern;
  -- Only identity facts and memberships: no password hash, session, token or account row is read.
  SELECT coalesce(jsonb_agg(x.j ORDER BY x.created_at DESC, x.email, x.id), '[]'::jsonb) INTO found_rows FROM (
    SELECT u.id, u.created_at, u.email, jsonb_build_object(
      'id', u.id,
      'name', u.name,
      'email', u.email,
      'emailVerified', u.email_verified,
      'createdAt', u.created_at,
      'memberships', (
        SELECT coalesce(jsonb_agg(jsonb_build_object('organizationId', o.id, 'organizationName', o.name, 'role', m.role, 'status', m.status) ORDER BY o.name, o.id), '[]'::jsonb)
          FROM public.organization_memberships m JOIN public.organizations o ON o.id = m.organization_id
         WHERE m.user_id = u.id
      ),
      'isPlatformAdmin', EXISTS (SELECT 1 FROM public.platform_admins a WHERE a.user_id = u.id AND a.revoked_at IS NULL)
    ) AS j
    FROM public.auth_user u
    WHERE pattern IS NULL OR u.name ILIKE pattern OR u.email ILIKE pattern
    ORDER BY u.created_at DESC, u.email, u.id
    LIMIT lim OFFSET off
  ) x;
  RETURN jsonb_build_object('total', total, 'rows', found_rows);
END
$$;
--> statement-breakpoint

CREATE FUNCTION app_platform_listings(p_search text, p_limit integer, p_offset integer) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  pattern text := public.app_platform_like(p_search);
  lim integer := least(greatest(coalesce(p_limit, 25), 1), 100);
  off integer := greatest(coalesce(p_offset, 0), 0);
  total bigint;
  found_rows jsonb;
BEGIN
  PERFORM public.app_platform_guard();
  SELECT count(*) INTO total FROM public.marketplace_listings l JOIN public.organizations o ON o.id = l.organization_id
   WHERE pattern IS NULL OR o.name ILIKE pattern OR l.public_slug ILIKE pattern;
  SELECT coalesce(jsonb_agg(x.j ORDER BY x.updated_at DESC, x.id), '[]'::jsonb) INTO found_rows FROM (
    SELECT l.id, l.updated_at, jsonb_build_object(
      'id', l.id,
      'organizationId', o.id,
      'organizationName', o.name,
      'publicSlug', l.public_slug,
      'status', l.status,
      'publishedAt', l.published_at,
      'selectedServices', (SELECT count(*) FROM public.marketplace_listing_services ls WHERE ls.listing_id = l.id),
      'site', (SELECT jsonb_build_object('platformSlug', s.platform_slug, 'status', s.status, 'published', (s.status = 'published' AND s.published_version_id IS NOT NULL))
                 FROM public.sites s WHERE s.organization_id = l.organization_id AND s.is_primary),
      'moderation', jsonb_build_object('state', coalesce(pm.state, 'allowed'), 'reason', pm.reason, 'decidedAt', pm.decided_at),
      -- What a visitor can actually reach: the business published it AND the platform has not suspended it.
      'publiclyAvailable', (l.status = 'published' AND coalesce(pm.state, 'allowed') <> 'suspended')
    ) AS j
    FROM public.marketplace_listings l
    JOIN public.organizations o ON o.id = l.organization_id
    LEFT JOIN public.platform_listing_moderation pm ON pm.listing_id = l.id
    WHERE pattern IS NULL OR o.name ILIKE pattern OR l.public_slug ILIKE pattern
    ORDER BY l.updated_at DESC, l.id
    LIMIT lim OFFSET off
  ) x;
  RETURN jsonb_build_object('total', total, 'rows', found_rows);
END
$$;
--> statement-breakpoint

CREATE FUNCTION app_platform_reviews(p_search text, p_rating integer, p_limit integer, p_offset integer) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  pattern text := public.app_platform_like(p_search);
  lim integer := least(greatest(coalesce(p_limit, 25), 1), 100);
  off integer := greatest(coalesce(p_offset, 0), 0);
  total bigint;
  found_rows jsonb;
BEGIN
  PERFORM public.app_platform_guard();
  SELECT count(*) INTO total
    FROM public.reviews r JOIN public.organizations o ON o.id = r.organization_id LEFT JOIN public.customers c ON c.organization_id = r.organization_id AND c.id = r.customer_id
   WHERE (p_rating IS NULL OR r.rating = p_rating)
     AND (pattern IS NULL OR o.name ILIKE pattern OR r.review_text ILIKE pattern OR coalesce(r.contact_name, c.name) ILIKE pattern);
  SELECT coalesce(jsonb_agg(x.j ORDER BY x.submitted_on DESC, x.id), '[]'::jsonb) INTO found_rows FROM (
    SELECT r.id, r.submitted_on, jsonb_build_object(
      'id', r.id,
      'organizationId', o.id,
      'organizationName', o.name,
      'reviewer', coalesce(r.contact_name, c.name),
      'rating', r.rating,
      'text', r.review_text,
      'submittedOn', r.submitted_on,
      'source', r.source,
      'replied', EXISTS (SELECT 1 FROM public.review_replies rr WHERE rr.organization_id = r.organization_id AND rr.review_id = r.id)
    ) AS j
    FROM public.reviews r
    JOIN public.organizations o ON o.id = r.organization_id
    LEFT JOIN public.customers c ON c.organization_id = r.organization_id AND c.id = r.customer_id
    WHERE (p_rating IS NULL OR r.rating = p_rating)
      AND (pattern IS NULL OR o.name ILIKE pattern OR r.review_text ILIKE pattern OR coalesce(r.contact_name, c.name) ILIKE pattern)
    ORDER BY r.submitted_on DESC, r.id
    LIMIT lim OFFSET off
  ) x;
  RETURN jsonb_build_object('total', total, 'rows', found_rows);
END
$$;
--> statement-breakpoint

CREATE FUNCTION app_platform_system() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.app_platform_guard();
  RETURN jsonb_build_object(
    'databaseVersion', current_setting('server_version'),
    'migrationsApplied', CASE WHEN to_regclass('drizzle.__drizzle_migrations') IS NULL THEN NULL ELSE (SELECT count(*) FROM drizzle.__drizzle_migrations) END,
    'counts', jsonb_build_object(
      'organizations', (SELECT count(*) FROM public.organizations),
      'users', (SELECT count(*) FROM public.auth_user),
      'liveSessions', (SELECT count(*) FROM public.auth_session WHERE expires_at > now()),
      'memberships', (SELECT count(*) FROM public.organization_memberships),
      'sites', (SELECT count(*) FROM public.sites),
      'publishedSites', (SELECT count(*) FROM public.sites WHERE status = 'published' AND published_version_id IS NOT NULL),
      'activeDomains', (SELECT count(*) FROM public.site_domains WHERE status = 'active'),
      'readyAssets', (SELECT count(*) FROM public.assets WHERE status = 'ready'),
      'listings', (SELECT count(*) FROM public.marketplace_listings),
      'suspendedListings', (SELECT count(*) FROM public.platform_listing_moderation WHERE state = 'suspended'),
      'bookings', (SELECT count(*) FROM public.bookings),
      'reviews', (SELECT count(*) FROM public.reviews),
      'platformAdministrators', (SELECT count(*) FROM public.platform_admins WHERE revoked_at IS NULL),
      'auditEvents', (SELECT count(*) FROM public.platform_audit_events)
    )
  );
END
$$;
--> statement-breakpoint

CREATE FUNCTION app_platform_audit_recent(p_limit integer) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  lim integer := least(greatest(coalesce(p_limit, 20), 1), 100);
BEGIN
  PERFORM public.app_platform_guard();
  RETURN (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id', e.id, 'occurredAt', e.occurred_at, 'action', e.action, 'actorKind', e.actor_kind, 'actorLabel', e.actor_label,
      'targetKind', e.target_kind, 'targetId', e.target_id, 'reason', e.reason, 'metadata', e.metadata
    ) ORDER BY e.occurred_at DESC, e.id), '[]'::jsonb)
      FROM (SELECT * FROM public.platform_audit_events ORDER BY occurred_at DESC, id LIMIT lim) e
  );
END
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------------------------
-- 4. Moderation: the one platform WRITE the console can make
-- ---------------------------------------------------------------------------------------------------------------

-- Suspend or allow a listing. The business's own listing row is never touched; the decision and its audit event are written in one
-- transaction, so there is no suspension without a record of who made it. Deciding what a listing already is changes nothing and records nothing.
CREATE FUNCTION app_platform_set_listing_moderation(p_listing uuid, p_state text, p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  actor text := public.app_current_user_id();
  actor_email text;
  l public.marketplace_listings%ROWTYPE;
  current_state text;
  clean_reason text := nullif(btrim(coalesce(p_reason, '')), '');
BEGIN
  PERFORM public.app_platform_guard();
  IF p_listing IS NULL THEN RAISE EXCEPTION 'A listing is required.' USING ERRCODE = '22023'; END IF;
  IF p_state IS NULL OR p_state NOT IN ('allowed', 'suspended') THEN RAISE EXCEPTION 'Unknown moderation state.' USING ERRCODE = '22023'; END IF;
  IF clean_reason IS NOT NULL AND char_length(clean_reason) > 500 THEN RAISE EXCEPTION 'The reason is too long.' USING ERRCODE = '22023'; END IF;
  IF p_state = 'allowed' THEN clean_reason := NULL; END IF;

  -- Serialize decisions about one listing without blocking the business's own edits to it.
  PERFORM pg_advisory_xact_lock(hashtextextended('platform-listing-moderation:' || p_listing::text, 0));

  SELECT * INTO l FROM public.marketplace_listings WHERE id = p_listing;
  IF NOT FOUND THEN RETURN jsonb_build_object('found', false, 'changed', false); END IF;

  SELECT m.state INTO current_state FROM public.platform_listing_moderation m WHERE m.listing_id = p_listing;
  current_state := coalesce(current_state, 'allowed');
  IF current_state = p_state THEN
    RETURN jsonb_build_object('found', true, 'changed', false, 'state', current_state);
  END IF;

  INSERT INTO public.platform_listing_moderation AS m (listing_id, state, reason, decided_by, decided_at, revision)
  VALUES (p_listing, p_state, clean_reason, actor, now(), 1)
  ON CONFLICT (listing_id) DO UPDATE
    SET state = EXCLUDED.state, reason = EXCLUDED.reason, decided_by = EXCLUDED.decided_by, decided_at = EXCLUDED.decided_at, revision = m.revision + 1;

  SELECT u.email INTO actor_email FROM public.auth_user u WHERE u.id = actor;
  INSERT INTO public.platform_audit_events (action, actor_kind, actor_user_id, actor_label, target_kind, target_id, reason, metadata)
  VALUES (
    CASE p_state WHEN 'suspended' THEN 'marketplace_listing.suspended' ELSE 'marketplace_listing.unsuspended' END,
    'platform_admin', actor, coalesce(actor_email, actor), 'marketplace_listing', p_listing::text, clean_reason,
    jsonb_build_object('organizationId', l.organization_id, 'publicSlug', l.public_slug, 'tenantStatus', l.status, 'previous', current_state)
  );
  RETURN jsonb_build_object('found', true, 'changed', true, 'state', p_state);
END
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------------------------
-- 5. A listing the platform has suspended is not public, whatever the business chose
-- ---------------------------------------------------------------------------------------------------------------

-- The body of 0018's function with ONE added condition (the moderation row). A suspended listing is the same NULL as a listing that is
-- not published or does not exist, so a visitor cannot tell the cases apart. Nothing of the moderation row is returned.
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
  IF EXISTS (SELECT 1 FROM public.platform_listing_moderation pm WHERE pm.listing_id = l.id AND pm.state = 'suspended') THEN RETURN NULL; END IF;
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

-- ---------------------------------------------------------------------------------------------------------------
-- 6. Grants: tables closed to the runtime role, functions open to it and nobody else
-- ---------------------------------------------------------------------------------------------------------------

REVOKE ALL ON TABLE platform_admins, platform_listing_moderation, platform_audit_events FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON TABLE platform_admins, platform_listing_moderation, platform_audit_events FROM climvia_app;
--> statement-breakpoint

REVOKE ALL ON FUNCTION app_platform_guard() FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_platform_like(text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION platform_audit_events_refuse() FROM PUBLIC;
--> statement-breakpoint

REVOKE ALL ON FUNCTION app_is_platform_admin() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_is_platform_admin() TO climvia_app;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_platform_overview() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_platform_overview() TO climvia_app;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_platform_organizations(text, integer, integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_platform_organizations(text, integer, integer) TO climvia_app;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_platform_organization(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_platform_organization(uuid) TO climvia_app;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_platform_users(text, integer, integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_platform_users(text, integer, integer) TO climvia_app;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_platform_listings(text, integer, integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_platform_listings(text, integer, integer) TO climvia_app;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_platform_reviews(text, integer, integer, integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_platform_reviews(text, integer, integer, integer) TO climvia_app;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_platform_system() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_platform_system() TO climvia_app;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_platform_audit_recent(integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_platform_audit_recent(integer) TO climvia_app;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_platform_set_listing_moderation(uuid, text, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_platform_set_listing_moderation(uuid, text, text) TO climvia_app;

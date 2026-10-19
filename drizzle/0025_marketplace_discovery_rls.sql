-- Phase 19B: Marketplace discovery. Hand-written, on top of 0024's tables and columns.
--
--   1. Service areas: Row Level Security (members read, owners and admins write), grants, a limit of 50 per listing.
--   2. Reviews: a review becomes public only through its `visibility`; one predicate (app_review_is_public) decides, so a later review
--      moderation changes ONE function. A reviewer is shown as "Sarah M." (app_reviewer_display_name).
--   3. Internal helpers (never executable by the runtime role): the cleaned search words and the one function that decides which listings a
--      search matches.
--   4. The public functions: search, facets, sitemap, the upgraded listing, the booking context and the Marketplace booking. The Website
--      booking and the Marketplace booking share one internal insert, so a booking is made one way.
--   5. A tenant-scoped boolean: is MY listing suspended (and nothing else about it).
--   6. The platform console's listing and review reads, extended.
--   7. Grants.
--
-- A listing is discoverable only when the business has it published AND the platform has not suspended it AND it shows at least one active public
-- Service. Every function below applies exactly that, in one place (app_marketplace_match) or beside the suspension check it extends.

-- ---------------------------------------------------------------------------------------------------------------
-- 1. Service areas
-- ---------------------------------------------------------------------------------------------------------------

CREATE POLICY marketplace_service_areas_select ON marketplace_service_areas FOR SELECT TO climvia_app
  USING (organization_id = app_current_org_id() AND app_is_member(organization_id));
--> statement-breakpoint
CREATE POLICY marketplace_service_areas_insert ON marketplace_service_areas FOR INSERT TO climvia_app
  WITH CHECK (organization_id = app_current_org_id() AND app_has_role(organization_id, ARRAY['owner', 'admin']));
--> statement-breakpoint
CREATE POLICY marketplace_service_areas_delete ON marketplace_service_areas FOR DELETE TO climvia_app
  USING (organization_id = app_current_org_id() AND app_has_role(organization_id, ARRAY['owner', 'admin']));
--> statement-breakpoint

-- Rows are replaced as a set (delete, insert); there is no UPDATE.
GRANT SELECT, INSERT, DELETE ON marketplace_service_areas TO climvia_app;
--> statement-breakpoint

CREATE FUNCTION marketplace_service_areas_guard() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF (SELECT count(*) FROM public.marketplace_service_areas a WHERE a.listing_id = NEW.listing_id) >= 50 THEN
    RAISE EXCEPTION 'A listing can list at most 50 service areas'
      USING ERRCODE = '23514', CONSTRAINT = 'marketplace_service_areas_limit';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER marketplace_service_areas_guard BEFORE INSERT ON marketplace_service_areas FOR EACH ROW EXECUTE FUNCTION marketplace_service_areas_guard();
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------------------------
-- 2. Reviews: visibility, the public predicate, the reviewer's display name
-- ---------------------------------------------------------------------------------------------------------------

-- The time a review became public is the database's to set: public rows have one, private rows have none.
CREATE FUNCTION reviews_visibility_guard() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.visibility = 'public' THEN
    NEW.made_public_at := COALESCE(CASE WHEN TG_OP = 'UPDATE' THEN OLD.made_public_at END, NEW.made_public_at, now());
  ELSE
    NEW.made_public_at := NULL;
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER reviews_visibility_guard BEFORE INSERT OR UPDATE ON reviews FOR EACH ROW EXECUTE FUNCTION reviews_visibility_guard();
--> statement-breakpoint

-- THE definition of a review that may be shown to the public and counted in a public rating. Review moderation, when it exists, narrows it here
-- (and nowhere else). A SQL function without SET options, so the planner inlines it.
CREATE FUNCTION app_review_is_public(r public.reviews) RETURNS boolean
LANGUAGE sql STABLE
AS $$ SELECT r.visibility = 'public' AND r.source = 'Climvia' $$;
--> statement-breakpoint

-- "Sarah Mitchell" -> "Sarah M."; one word stays as it is; nothing -> "Customer". Pure: the full name never leaves the database on a public path.
CREATE FUNCTION app_reviewer_display_name(p_name text) RETURNS text
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
  parts text[];
BEGIN
  IF p_name IS NULL OR btrim(p_name) = '' THEN RETURN 'Customer'; END IF;
  parts := regexp_split_to_array(btrim(p_name), '\s+');
  IF array_length(parts, 1) = 1 THEN RETURN left(parts[1], 40); END IF;
  RETURN left(parts[1], 40) || ' ' || upper(left(parts[array_length(parts, 1)], 1)) || '.';
END
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------------------------
-- 3. Internal helpers
-- ---------------------------------------------------------------------------------------------------------------

-- The words of a search, cleaned again here: letters and digits, at most 40 characters each, at most 8 of them. Whatever the caller sends.
CREATE FUNCTION app_marketplace_tokens(p_tokens text[]) RETURNS text[]
LANGUAGE sql IMMUTABLE
AS $$
  SELECT coalesce(array_agg(w.word ORDER BY w.word), '{}'::text[])
    FROM (SELECT DISTINCT lower(x) AS word FROM unnest(coalesce(p_tokens, '{}'::text[])) AS x WHERE x ~ '^[A-Za-z0-9]{1,40}$' LIMIT 8) w
$$;
--> statement-breakpoint

-- The listings a search matches, as ids. The ONE place that says what is discoverable:
--   published by the business, not suspended by the platform, showing at least one active public Service;
--   then every filter given: a Service, a category, a way of booking (all of them on the same Service), a place (a configured service area), and every
--   word of the search found in the business name, in a shown Service's name or category, or in a service area.
-- A value that is not valid matches nothing. A business with no service areas matches no place and no place-word.
CREATE FUNCTION app_marketplace_match(p_tokens text[], p_service text, p_location text, p_booking text, p_category text) RETURNS SETOF uuid
LANGUAGE plpgsql STABLE SET search_path = public, pg_temp
AS $$
DECLARE
  toks text[] := public.app_marketplace_tokens(p_tokens);
  us_states text[] := ARRAY['AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY'];
  svc text := nullif(btrim(p_service), '');
  bk text := nullif(btrim(p_booking), '');
  cat text := nullif(btrim(p_category), '');
  loc text := nullif(lower(btrim(p_location)), '');
  loc_kind text;
  loc_postal text;
  loc_city text;
  loc_state text;
  parts text[];
BEGIN
  IF svc IS NOT NULL AND (char_length(svc) > 80 OR svc !~ '^[a-z0-9]+(-[a-z0-9]+)*$') THEN RETURN; END IF;
  IF bk IS NOT NULL AND bk NOT IN ('instant', 'request-appointment', 'request-quote') THEN RETURN; END IF;
  IF cat IS NOT NULL AND cat NOT IN ('Cooling', 'Heating', 'Heat pumps', 'Maintenance', 'Emergency') THEN RETURN; END IF;
  IF loc IS NOT NULL THEN
    IF loc ~ '^[0-9]{5}$' THEN
      loc_kind := 'postal';
      loc_postal := loc;
    ELSIF char_length(loc) <= 80 AND loc ~ '^[a-z]+(-[a-z]+)*$' THEN
      loc_kind := 'city';
      parts := regexp_match(loc, '^(.+)-([a-z]{2})$');
      IF parts IS NOT NULL AND upper(parts[2]) = ANY (us_states) THEN
        loc_city := replace(parts[1], '-', ' ');
        loc_state := upper(parts[2]);
      ELSE
        loc_city := replace(loc, '-', ' ');
      END IF;
    ELSE
      RETURN;
    END IF;
  END IF;

  RETURN QUERY
  SELECT l.id
    FROM public.marketplace_listings l
    JOIN public.organizations o ON o.id = l.organization_id
   WHERE l.status = 'published'
     AND NOT EXISTS (SELECT 1 FROM public.platform_listing_moderation pm WHERE pm.listing_id = l.id AND pm.state = 'suspended')
     AND EXISTS (
       SELECT 1
         FROM public.marketplace_listing_services ls
         JOIN public.services sv ON sv.organization_id = ls.organization_id AND sv.id = ls.service_id
        WHERE ls.listing_id = l.id AND sv.is_active AND sv.visibility <> 'internal'
          AND (svc IS NULL OR sv.slug = svc)
          AND (cat IS NULL OR sv.category = cat)
          AND (bk IS NULL OR (sv.booking_method = bk AND sv.visibility = 'public-booking' AND l.action_book))
     )
     AND NOT EXISTS (
       SELECT 1 FROM unnest(toks) AS t(word)
        WHERE NOT (
          lower(o.name) ~ ('\m' || t.word)
          OR EXISTS (
            SELECT 1
              FROM public.marketplace_listing_services ls
              JOIN public.services sv ON sv.organization_id = ls.organization_id AND sv.id = ls.service_id
             WHERE ls.listing_id = l.id AND sv.is_active AND sv.visibility <> 'internal'
               AND lower(sv.name || ' ' || sv.category) ~ ('\m' || t.word)
          )
          OR EXISTS (
            SELECT 1 FROM public.marketplace_service_areas a
             WHERE a.listing_id = l.id
               AND (a.city_key ~ ('\m' || t.word) OR lower(a.state_region) = t.word OR (t.word ~ '^[0-9]+$' AND a.postal_code LIKE t.word || '%'))
          )
        )
     )
     AND (
       loc_kind IS NULL
       OR EXISTS (
         SELECT 1 FROM public.marketplace_service_areas a
          WHERE a.listing_id = l.id
            AND ((loc_kind = 'postal' AND a.postal_code = loc_postal)
              OR (loc_kind = 'city' AND a.city_key = loc_city AND (loc_state IS NULL OR a.state_region = loc_state)))
       )
     );
END
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------------------------
-- 4. The public functions
-- ---------------------------------------------------------------------------------------------------------------

-- One page of provider cards, ranked, and the total. Only public fields are built, field by field.
CREATE FUNCTION app_public_marketplace_search(
  p_tokens text[], p_service text, p_location text, p_booking text, p_category text, p_page integer, p_page_size integer
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  toks text[] := public.app_marketplace_tokens(p_tokens);
  svc text := nullif(btrim(p_service), '');
  cat text := nullif(btrim(p_category), '');
  bk text := nullif(btrim(p_booking), '');
  loc text := nullif(lower(btrim(p_location)), '');
  size integer := least(greatest(coalesce(p_page_size, 12), 1), 24);
  pg integer := least(greatest(coalesce(p_page, 1), 1), 100);
  ids uuid[];
  cards jsonb;
BEGIN
  SELECT coalesce(array_agg(m), '{}'::uuid[]) INTO ids FROM public.app_marketplace_match(toks, svc, loc, bk, cat) AS m;

  SELECT coalesce(jsonb_agg(c.card ORDER BY c.ord), '[]'::jsonb) INTO cards FROM (
    SELECT p.ord, jsonb_build_object(
      'slug', p.public_slug,
      'name', p.name,
      'description', p.description,
      'logo', (
        SELECT jsonb_build_object('assetId', a.id)
          FROM public.organization_branding b
          JOIN public.assets a ON a.organization_id = b.organization_id AND a.id = b.logo_asset_id
         WHERE b.organization_id = p.organization_id AND a.status = 'ready' AND a.purpose = 'logo'
      ),
      'rating', CASE WHEN p.reviews > 0 THEN jsonb_build_object('average', round(p.average, 1), 'count', p.reviews) ELSE NULL END,
      'service', ms.j,
      'serviceCount', (
        SELECT count(*) FROM public.marketplace_listing_services ls JOIN public.services sv ON sv.organization_id = ls.organization_id AND sv.id = ls.service_id
         WHERE ls.listing_id = p.id AND sv.is_active AND sv.visibility <> 'internal'
      ),
      'categories', (
        SELECT coalesce(jsonb_agg(DISTINCT sv.category ORDER BY sv.category), '[]'::jsonb)
          FROM public.marketplace_listing_services ls JOIN public.services sv ON sv.organization_id = ls.organization_id AND sv.id = ls.service_id
         WHERE ls.listing_id = p.id AND sv.is_active AND sv.visibility <> 'internal'
      ),
      'areas', ar.j,
      'areaCount', ar.n,
      'canBook', (p.action_book AND ms.bookable)
    ) AS card
    FROM (
      SELECT x.*, row_number() OVER (ORDER BY x.service_hits DESC, x.name_hits DESC, x.average DESC NULLS LAST, x.reviews DESC, lower(x.name), x.id) AS ord
        FROM (
          SELECT l.id, l.organization_id, l.public_slug, l.description, l.action_book, o.name, rt.average, coalesce(rt.reviews, 0) AS reviews,
                 (SELECT count(*) FROM unnest(toks) AS t(word) WHERE EXISTS (
                    SELECT 1 FROM public.marketplace_listing_services ls JOIN public.services sv ON sv.organization_id = ls.organization_id AND sv.id = ls.service_id
                     WHERE ls.listing_id = l.id AND sv.is_active AND sv.visibility <> 'internal' AND lower(sv.name || ' ' || sv.category) ~ ('\m' || t.word)
                 )) AS service_hits,
                 (SELECT count(*) FROM unnest(toks) AS t(word) WHERE lower(o.name) ~ ('\m' || t.word)) AS name_hits
            FROM public.marketplace_listings l
            JOIN public.organizations o ON o.id = l.organization_id
            LEFT JOIN (
              SELECT r.organization_id, round(avg(r.rating)::numeric, 2) AS average, count(*)::integer AS reviews
                FROM public.reviews r
               WHERE public.app_review_is_public(r) AND r.organization_id IN (SELECT l2.organization_id FROM public.marketplace_listings l2 WHERE l2.id = ANY (ids))
               GROUP BY r.organization_id
            ) rt ON rt.organization_id = l.organization_id
           WHERE l.id = ANY (ids)
        ) x
    ) p
    LEFT JOIN LATERAL (
      SELECT jsonb_build_object(
               'slug', sv.slug, 'name', sv.name, 'category', sv.category, 'pricingModel', sv.pricing_model, 'priceAmount', sv.price_amount,
               'priceLabel', sv.price_label, 'bookingMethod', sv.booking_method, 'durationMinutes', sv.duration_minutes
             ) AS j,
             (sv.visibility = 'public-booking') AS bookable
        FROM public.marketplace_listing_services ls
        JOIN public.services sv ON sv.organization_id = ls.organization_id AND sv.id = ls.service_id
       WHERE ls.listing_id = p.id AND sv.is_active AND sv.visibility <> 'internal'
         AND (svc IS NULL OR sv.slug = svc)
         AND (cat IS NULL OR sv.category = cat)
         AND (bk IS NULL OR (sv.booking_method = bk AND sv.visibility = 'public-booking' AND p.action_book))
       ORDER BY (SELECT count(*) FROM unnest(toks) AS t(word) WHERE lower(sv.name || ' ' || sv.category) ~ ('\m' || t.word)) DESC, ls.sort_order, sv.display_order
       LIMIT 1
    ) ms ON true
    LEFT JOIN LATERAL (
      SELECT count(*)::integer AS n,
             coalesce(jsonb_agg(jsonb_build_object('display', y.display, 'slug', y.slug) ORDER BY y.rn) FILTER (WHERE y.rn <= 4), '[]'::jsonb) AS j
        FROM (
          SELECT z.display, z.slug, row_number() OVER (ORDER BY z.rank, z.sort_order) AS rn
            FROM (
              SELECT a.sort_order,
                     coalesce(a.label, CASE WHEN a.city IS NOT NULL THEN a.city || ', ' || a.state_region ELSE a.postal_code END) AS display,
                     CASE WHEN a.city IS NOT NULL THEN replace(a.city_key, ' ', '-') || '-' || lower(a.state_region) ELSE a.postal_code END AS slug,
                     CASE WHEN loc IS NOT NULL AND (
                            a.postal_code = loc
                            OR (a.city IS NOT NULL AND (replace(a.city_key, ' ', '-') || '-' || lower(a.state_region) = loc OR replace(a.city_key, ' ', '-') = loc))
                          ) THEN 0 ELSE 1 END AS rank
                FROM public.marketplace_service_areas a WHERE a.listing_id = p.id
            ) z
        ) y
    ) ar ON true
    WHERE p.ord > (pg - 1) * size AND p.ord <= pg * size
  ) c;

  RETURN jsonb_build_object('total', cardinality(ids), 'page', pg, 'pageSize', size, 'results', cards);
END
$$;
--> statement-breakpoint

-- What there is to choose from, given what has been chosen: each list leaves out its own filter, so choosing one thing shows the others that still have
-- providers. Real data only; counts are providers.
CREATE FUNCTION app_public_marketplace_facets(p_tokens text[], p_service text, p_location text, p_booking text, p_category text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  toks text[] := public.app_marketplace_tokens(p_tokens);
  svc text := nullif(btrim(p_service), '');
  cat text := nullif(btrim(p_category), '');
  bk text := nullif(btrim(p_booking), '');
  loc text := nullif(lower(btrim(p_location)), '');
  for_services uuid[];
  for_locations uuid[];
  for_categories uuid[];
  for_booking uuid[];
BEGIN
  SELECT coalesce(array_agg(m), '{}'::uuid[]) INTO for_services FROM public.app_marketplace_match(toks, NULL, loc, bk, cat) AS m;
  SELECT coalesce(array_agg(m), '{}'::uuid[]) INTO for_locations FROM public.app_marketplace_match(toks, svc, NULL, bk, cat) AS m;
  SELECT coalesce(array_agg(m), '{}'::uuid[]) INTO for_categories FROM public.app_marketplace_match(toks, svc, loc, bk, NULL) AS m;
  SELECT coalesce(array_agg(m), '{}'::uuid[]) INTO for_booking FROM public.app_marketplace_match(toks, svc, loc, NULL, cat) AS m;

  RETURN jsonb_build_object(
    'services', (
      SELECT coalesce(jsonb_agg(jsonb_build_object('slug', x.slug, 'name', x.name, 'providers', x.providers) ORDER BY x.providers DESC, x.name, x.slug), '[]'::jsonb)
        FROM (
          SELECT sv.slug, min(sv.name) AS name, count(DISTINCT ls.listing_id)::integer AS providers
            FROM public.marketplace_listing_services ls
            JOIN public.services sv ON sv.organization_id = ls.organization_id AND sv.id = ls.service_id
            JOIN public.marketplace_listings l ON l.id = ls.listing_id
           WHERE ls.listing_id = ANY (for_services) AND sv.is_active AND sv.visibility <> 'internal'
             AND (cat IS NULL OR sv.category = cat)
             AND (bk IS NULL OR (sv.booking_method = bk AND sv.visibility = 'public-booking' AND l.action_book))
           GROUP BY sv.slug ORDER BY providers DESC, name, slug LIMIT 40
        ) x
    ),
    'locations', (
      SELECT coalesce(jsonb_agg(jsonb_build_object('slug', x.slug, 'kind', x.kind, 'label', x.label, 'providers', x.providers) ORDER BY x.providers DESC, x.label, x.slug), '[]'::jsonb)
        FROM (
          SELECT y.slug, y.kind, min(y.label) AS label, count(DISTINCT y.listing_id)::integer AS providers
            FROM (
              SELECT a.listing_id,
                     CASE WHEN a.city IS NOT NULL THEN replace(a.city_key, ' ', '-') || '-' || lower(a.state_region) ELSE a.postal_code END AS slug,
                     CASE WHEN a.city IS NOT NULL THEN 'city' ELSE 'postal' END AS kind,
                     CASE WHEN a.city IS NOT NULL THEN a.city || ', ' || a.state_region ELSE a.postal_code END AS label
                FROM public.marketplace_service_areas a WHERE a.listing_id = ANY (for_locations)
            ) y
           GROUP BY y.slug, y.kind ORDER BY providers DESC, label, slug LIMIT 60
        ) x
    ),
    'categories', (
      SELECT coalesce(jsonb_agg(jsonb_build_object('name', x.category, 'providers', x.providers) ORDER BY x.category), '[]'::jsonb)
        FROM (
          SELECT sv.category, count(DISTINCT ls.listing_id)::integer AS providers
            FROM public.marketplace_listing_services ls
            JOIN public.services sv ON sv.organization_id = ls.organization_id AND sv.id = ls.service_id
            JOIN public.marketplace_listings l ON l.id = ls.listing_id
           WHERE ls.listing_id = ANY (for_categories) AND sv.is_active AND sv.visibility <> 'internal'
             AND (svc IS NULL OR sv.slug = svc)
             AND (bk IS NULL OR (sv.booking_method = bk AND sv.visibility = 'public-booking' AND l.action_book))
           GROUP BY sv.category
        ) x
    ),
    'bookingModes', (
      SELECT coalesce(jsonb_agg(jsonb_build_object('mode', x.booking_method, 'providers', x.providers) ORDER BY x.booking_method), '[]'::jsonb)
        FROM (
          SELECT sv.booking_method, count(DISTINCT ls.listing_id)::integer AS providers
            FROM public.marketplace_listing_services ls
            JOIN public.services sv ON sv.organization_id = ls.organization_id AND sv.id = ls.service_id
            JOIN public.marketplace_listings l ON l.id = ls.listing_id
           WHERE ls.listing_id = ANY (for_booking) AND sv.is_active AND sv.visibility = 'public-booking' AND l.action_book
             AND (svc IS NULL OR sv.slug = svc)
             AND (cat IS NULL OR sv.category = cat)
           GROUP BY sv.booking_method
        ) x
    )
  );
END
$$;
--> statement-breakpoint

-- Everything a search engine may be told about: discoverable providers, and the Service and place pages that have at least one provider. Bounded.
CREATE FUNCTION app_public_marketplace_sitemap() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  ids uuid[];
BEGIN
  SELECT coalesce(array_agg(m), '{}'::uuid[]) INTO ids FROM public.app_marketplace_match(NULL, NULL, NULL, NULL, NULL) AS m;
  RETURN jsonb_build_object(
    'listings', (
      SELECT coalesce(jsonb_agg(jsonb_build_object('slug', x.public_slug, 'updatedAt', x.updated_at) ORDER BY x.public_slug), '[]'::jsonb)
        FROM (SELECT l.public_slug, l.updated_at FROM public.marketplace_listings l WHERE l.id = ANY (ids) ORDER BY l.public_slug LIMIT 5000) x
    ),
    'services', (
      SELECT coalesce(jsonb_agg(x.slug ORDER BY x.slug), '[]'::jsonb)
        FROM (
          SELECT DISTINCT sv.slug FROM public.marketplace_listing_services ls JOIN public.services sv ON sv.organization_id = ls.organization_id AND sv.id = ls.service_id
           WHERE ls.listing_id = ANY (ids) AND sv.is_active AND sv.visibility <> 'internal' ORDER BY sv.slug LIMIT 500
        ) x
    ),
    'locations', (
      SELECT coalesce(jsonb_agg(x.slug ORDER BY x.slug), '[]'::jsonb)
        FROM (
          SELECT DISTINCT CASE WHEN a.city IS NOT NULL THEN replace(a.city_key, ' ', '-') || '-' || lower(a.state_region) ELSE a.postal_code END AS slug
            FROM public.marketplace_service_areas a WHERE a.listing_id = ANY (ids) ORDER BY 1 LIMIT 500
        ) x
    ),
    'combinations', (
      SELECT coalesce(jsonb_agg(jsonb_build_object('service', x.service, 'location', x.location) ORDER BY x.service, x.location), '[]'::jsonb)
        FROM (
          SELECT DISTINCT sv.slug AS service,
                 CASE WHEN a.city IS NOT NULL THEN replace(a.city_key, ' ', '-') || '-' || lower(a.state_region) ELSE a.postal_code END AS location
            FROM public.marketplace_listing_services ls
            JOIN public.services sv ON sv.organization_id = ls.organization_id AND sv.id = ls.service_id
            JOIN public.marketplace_service_areas a ON a.listing_id = ls.listing_id
           WHERE ls.listing_id = ANY (ids) AND sv.is_active AND sv.visibility <> 'internal'
           ORDER BY 1, 2 LIMIT 2000
        ) x
    )
  );
END
$$;
--> statement-breakpoint

-- The listing as a visitor sees it: 0023's body, with the places the business works, its public rating and its latest public reviews, and each Service's
-- category. A listing that is not published, or is suspended, or does not exist, is the same NULL.
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
    'sitePages', CASE WHEN site_slug IS NULL THEN '[]'::jsonb ELSE (
      SELECT coalesce(jsonb_agg(jsonb_build_object('key', p.page_key, 'title', p.title, 'slug', p.slug, 'type', p.page_type) ORDER BY p.sort_order), '[]'::jsonb)
        FROM public.site_pages p WHERE p.site_version_id = site_version AND p.is_visible
    ) END,
    'services', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'slug', sv.slug, 'name', sv.name, 'category', sv.category, 'description', sv.description, 'durationMinutes', sv.duration_minutes,
        'pricingModel', sv.pricing_model, 'priceAmount', sv.price_amount, 'priceLabel', sv.price_label, 'bookingMethod', sv.booking_method, 'visibility', sv.visibility
      ) ORDER BY ls.sort_order, sv.display_order), '[]'::jsonb)
        FROM public.marketplace_listing_services ls
        JOIN public.services sv ON sv.organization_id = ls.organization_id AND sv.id = ls.service_id
       WHERE ls.listing_id = l.id AND sv.is_active AND sv.visibility <> 'internal'
    ),
    'serviceAreas', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'display', coalesce(a.label, CASE WHEN a.city IS NOT NULL THEN a.city || ', ' || a.state_region ELSE a.postal_code END),
        'kind', CASE WHEN a.city IS NOT NULL THEN 'city' ELSE 'postal' END,
        'slug', CASE WHEN a.city IS NOT NULL THEN replace(a.city_key, ' ', '-') || '-' || lower(a.state_region) ELSE a.postal_code END
      ) ORDER BY a.sort_order), '[]'::jsonb)
        FROM public.marketplace_service_areas a WHERE a.listing_id = l.id
    ),
    'rating', (
      SELECT CASE WHEN count(*) = 0 THEN NULL ELSE jsonb_build_object('average', round(avg(r.rating)::numeric, 1), 'count', count(*)) END
        FROM public.reviews r WHERE r.organization_id = o.id AND public.app_review_is_public(r)
    ),
    'reviews', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'rating', x.rating, 'text', x.review_text, 'date', x.submitted_on, 'reviewer', public.app_reviewer_display_name(x.reviewer)
      ) ORDER BY x.submitted_on DESC, x.created_at DESC, x.id), '[]'::jsonb)
        FROM (
          SELECT r.id, r.rating, r.review_text, r.submitted_on, r.created_at, coalesce(r.contact_name, c.name) AS reviewer
            FROM public.reviews r
            LEFT JOIN public.customers c ON c.organization_id = r.organization_id AND c.id = r.customer_id
           WHERE r.organization_id = o.id AND public.app_review_is_public(r)
           ORDER BY r.submitted_on DESC, r.created_at DESC, r.id
           LIMIT 10
        ) x
    )
  );
END
$$;
--> statement-breakpoint

-- What the Marketplace booking page and action need for ONE Service of ONE published, allowed listing that offers online booking. The hours are
-- here whether or not the profile shows them (the slots a customer is offered come from them); the phone only when the profile shows it.
CREATE FUNCTION app_public_listing_booking(p_public_slug text, p_service_slug text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  l public.marketplace_listings%ROWTYPE;
  o public.organizations%ROWTYPE;
  sv public.services%ROWTYPE;
BEGIN
  IF p_public_slug IS NULL OR char_length(p_public_slug) > 63 OR p_service_slug IS NULL OR char_length(p_service_slug) > 80 THEN RETURN NULL; END IF;
  SELECT * INTO l FROM public.marketplace_listings WHERE public_slug = lower(p_public_slug);
  IF NOT FOUND OR l.status <> 'published' OR NOT l.action_book THEN RETURN NULL; END IF;
  IF EXISTS (SELECT 1 FROM public.platform_listing_moderation pm WHERE pm.listing_id = l.id AND pm.state = 'suspended') THEN RETURN NULL; END IF;
  SELECT s.* INTO sv FROM public.services s
    JOIN public.marketplace_listing_services ls ON ls.organization_id = s.organization_id AND ls.service_id = s.id
   WHERE ls.listing_id = l.id AND s.slug = p_service_slug AND s.is_active AND s.visibility = 'public-booking';
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO o FROM public.organizations WHERE id = l.organization_id;

  RETURN jsonb_build_object(
    'listing', jsonb_build_object('publicSlug', l.public_slug),
    'organization', jsonb_build_object(
      'name', o.name,
      'phone', CASE WHEN l.show_phone THEN o.phone END,
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
    'fixedClock', coalesce(o.fixture_set = 'apex-demo', false),
    'service', jsonb_build_object(
      'slug', sv.slug, 'name', sv.name, 'category', sv.category, 'description', sv.description, 'durationMinutes', sv.duration_minutes,
      'pricingModel', sv.pricing_model, 'priceAmount', sv.price_amount, 'priceLabel', sv.price_label, 'bookingMethod', sv.booking_method,
      'visibility', sv.visibility, 'displayOrder', sv.display_order, 'intake', sv.intake
    )
  );
END
$$;
--> statement-breakpoint

-- The one place a public booking is written. INTERNAL: the two public booking functions call it after they have found the business and the Service from a
-- PUBLIC identity; the runtime role cannot call it. It validates the visitor's details, finds a repeat of the same request, takes the business's next
-- number and inserts one booking. `p_source` is chosen by the CALLER, never by a request.
CREATE FUNCTION app_insert_public_booking(
  p_organization_id uuid, p_service_id uuid, p_booking_method text, p_source text, p_listing_id uuid, p_discovery_service text, p_discovery_location text,
  p_submission_key text, p_service_date date, p_start time, p_end time,
  p_contact_name text, p_contact_phone text, p_contact_email text, p_contact_address text, p_note text,
  p_intake_system_type text, p_intake_reported_issue text, p_received_at timestamptz
) RETURNS jsonb
LANGUAGE plpgsql SET search_path = public, pg_temp
AS $$
DECLARE
  existing public.bookings%ROWTYPE;
  new_status text;
  new_number integer;
BEGIN
  IF p_contact_name IS NULL OR char_length(btrim(p_contact_name)) NOT BETWEEN 1 AND 80
     OR p_contact_email IS NULL OR char_length(p_contact_email) > 200
     OR p_contact_phone IS NULL OR char_length(p_contact_phone) > 60
     OR p_contact_address IS NULL OR char_length(btrim(p_contact_address)) NOT BETWEEN 1 AND 300
     OR p_service_date IS NULL OR p_start IS NULL OR p_end IS NULL OR p_end <= p_start THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'details');
  END IF;

  -- The same submission again: the booking it already made.
  IF p_submission_key IS NOT NULL THEN
    SELECT * INTO existing FROM public.bookings WHERE organization_id = p_organization_id AND submission_key = p_submission_key;
    IF FOUND THEN RETURN jsonb_build_object('ok', true, 'duplicate', true, 'number', existing.number, 'status', existing.status); END IF;
  END IF;
  -- The same person asking for the same Service at the same time again.
  SELECT * INTO existing FROM public.bookings
   WHERE organization_id = p_organization_id AND source = p_source AND service_id = p_service_id AND service_date = p_service_date AND start_time = p_start
     AND lower(contact_email) = lower(p_contact_email) AND status IN ('pending', 'confirmed')
   ORDER BY number LIMIT 1;
  IF FOUND THEN RETURN jsonb_build_object('ok', true, 'duplicate', true, 'number', existing.number, 'status', existing.status); END IF;

  new_status := CASE p_booking_method WHEN 'instant' THEN 'confirmed' ELSE 'pending' END;
  -- A business's counter starts at 1001 and walks past numbers already stored (a baseline booking may hold one).
  LOOP
    new_number := public.app_take_number(p_organization_id, 'booking');
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.bookings b WHERE b.organization_id = p_organization_id AND b.number = new_number);
  END LOOP;

  INSERT INTO public.bookings (
    organization_id, number, customer_id, property_id, service_id, assignee_id, contact_name, contact_phone, contact_email, contact_address,
    source, marketplace_listing_id, discovery_service, discovery_location,
    status, service_date, start_time, end_time, note, intake_system_type, intake_reported_issue, submission_key, received_at, confirmed_at
  ) VALUES (
    p_organization_id, new_number, NULL, NULL, p_service_id, NULL, btrim(p_contact_name), btrim(p_contact_phone), btrim(p_contact_email), btrim(p_contact_address),
    p_source, p_listing_id, p_discovery_service, p_discovery_location,
    new_status, p_service_date, p_start, p_end, nullif(btrim(coalesce(p_note, '')), ''), nullif(btrim(coalesce(p_intake_system_type, '')), ''),
    nullif(btrim(coalesce(p_intake_reported_issue, '')), ''), p_submission_key, coalesce(p_received_at, now()), CASE WHEN new_status = 'confirmed' THEN coalesce(p_received_at, now()) END
  );
  RETURN jsonb_build_object('ok', true, 'duplicate', false, 'number', new_number, 'status', new_status);
END
$$;
--> statement-breakpoint

-- The Website booking, unchanged in behaviour (same checks, same answers, same order); it now writes through the shared insert.
CREATE OR REPLACE FUNCTION app_public_create_booking(
  p_platform_slug text, p_service_slug text, p_submission_key text,
  p_service_date date, p_start time, p_end time,
  p_contact_name text, p_contact_phone text, p_contact_email text, p_contact_address text, p_note text,
  p_intake_system_type text, p_intake_reported_issue text,
  p_received_at timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  s public.sites%ROWTYPE;
  sv public.services%ROWTYPE;
BEGIN
  IF p_platform_slug IS NULL OR char_length(p_platform_slug) > 63 THEN RETURN jsonb_build_object('ok', false, 'reason', 'site'); END IF;
  SELECT * INTO s FROM public.sites WHERE platform_slug = lower(p_platform_slug);
  IF NOT FOUND OR s.status <> 'published' OR s.published_version_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'site'); END IF;

  SELECT * INTO sv FROM public.services
   WHERE organization_id = s.organization_id AND slug = p_service_slug AND is_active AND visibility = 'public-booking';
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'service'); END IF;

  RETURN public.app_insert_public_booking(
    s.organization_id, sv.id, sv.booking_method, 'Website', NULL, NULL, NULL,
    p_submission_key, p_service_date, p_start, p_end,
    p_contact_name, p_contact_phone, p_contact_email, p_contact_address, p_note,
    p_intake_system_type, p_intake_reported_issue, p_received_at
  );
END
$$;
--> statement-breakpoint

-- A booking made from a Marketplace listing. The business and the Service are found HERE from the listing's public identity and the Service's address:
-- the listing must be published, not suspended and offer online booking; the Service must be one the listing shows and the business offers for online
-- booking. The source ("Marketplace") and the listing are written by this function; the discovery values (the Service and place the visitor was looking at)
-- are kept only if they have the shape of an address, and decide nothing.
CREATE FUNCTION app_public_create_marketplace_booking(
  p_public_slug text, p_service_slug text, p_submission_key text,
  p_service_date date, p_start time, p_end time,
  p_contact_name text, p_contact_phone text, p_contact_email text, p_contact_address text, p_note text,
  p_intake_system_type text, p_intake_reported_issue text,
  p_discovery_service text DEFAULT NULL, p_discovery_location text DEFAULT NULL,
  p_received_at timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  l public.marketplace_listings%ROWTYPE;
  sv public.services%ROWTYPE;
  disc_service text;
  disc_location text;
BEGIN
  IF p_public_slug IS NULL OR char_length(p_public_slug) > 63 THEN RETURN jsonb_build_object('ok', false, 'reason', 'listing'); END IF;
  SELECT * INTO l FROM public.marketplace_listings WHERE public_slug = lower(p_public_slug);
  IF NOT FOUND OR l.status <> 'published' OR NOT l.action_book THEN RETURN jsonb_build_object('ok', false, 'reason', 'listing'); END IF;
  IF EXISTS (SELECT 1 FROM public.platform_listing_moderation pm WHERE pm.listing_id = l.id AND pm.state = 'suspended') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'listing');
  END IF;

  SELECT s.* INTO sv FROM public.services s
    JOIN public.marketplace_listing_services ls ON ls.organization_id = s.organization_id AND ls.service_id = s.id
   WHERE ls.listing_id = l.id AND s.slug = p_service_slug AND s.is_active AND s.visibility = 'public-booking';
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'service'); END IF;

  disc_service := CASE WHEN p_discovery_service ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length(p_discovery_service) <= 80 THEN p_discovery_service END;
  disc_location := CASE WHEN p_discovery_location ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length(p_discovery_location) <= 80 THEN p_discovery_location END;

  RETURN public.app_insert_public_booking(
    l.organization_id, sv.id, sv.booking_method, 'Marketplace', l.id, disc_service, disc_location,
    p_submission_key, p_service_date, p_start, p_end,
    p_contact_name, p_contact_phone, p_contact_email, p_contact_address, p_note,
    p_intake_system_type, p_intake_reported_issue, p_received_at
  );
END
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------------------------
-- 5. The business's own question: is my listing suspended?
-- ---------------------------------------------------------------------------------------------------------------

-- True only for a member of the ACTIVE organization whose listing the platform has suspended. It answers that and nothing else: the reason, who decided
-- and when stay where they are (the runtime role has no privilege on the moderation table).
CREATE FUNCTION app_listing_suspended() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.marketplace_listings l
      JOIN public.platform_listing_moderation pm ON pm.listing_id = l.id AND pm.state = 'suspended'
     WHERE l.organization_id = public.app_current_org_id() AND public.app_is_member(l.organization_id)
  )
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------------------------
-- 6. The platform console's reads, extended (0023's bodies, plus the new facts)
-- ---------------------------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_platform_listings(p_search text, p_limit integer, p_offset integer) RETURNS jsonb
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
      'serviceNames', (
        SELECT coalesce(jsonb_agg(sv.name ORDER BY ls.sort_order, sv.display_order), '[]'::jsonb)
          FROM public.marketplace_listing_services ls JOIN public.services sv ON sv.organization_id = ls.organization_id AND sv.id = ls.service_id
         WHERE ls.listing_id = l.id
      ),
      'serviceAreas', (
        SELECT coalesce(jsonb_agg(coalesce(a.label, CASE WHEN a.city IS NOT NULL THEN a.city || ', ' || a.state_region ELSE a.postal_code END) ORDER BY a.sort_order), '[]'::jsonb)
          FROM public.marketplace_service_areas a WHERE a.listing_id = l.id
      ),
      'site', (SELECT jsonb_build_object('platformSlug', s.platform_slug, 'status', s.status, 'published', (s.status = 'published' AND s.published_version_id IS NOT NULL))
                 FROM public.sites s WHERE s.organization_id = l.organization_id AND s.is_primary),
      'moderation', jsonb_build_object('state', coalesce(pm.state, 'allowed'), 'reason', pm.reason, 'decidedAt', pm.decided_at),
      -- What a visitor can actually reach: the business published it AND the platform has not suspended it.
      'publiclyAvailable', (l.status = 'published' AND coalesce(pm.state, 'allowed') <> 'suspended'),
      -- ... and whether the Marketplace lists it: it also shows at least one active public Service.
      'discoverable', (
        l.status = 'published' AND coalesce(pm.state, 'allowed') <> 'suspended'
        AND EXISTS (
          SELECT 1 FROM public.marketplace_listing_services ls JOIN public.services sv ON sv.organization_id = ls.organization_id AND sv.id = ls.service_id
           WHERE ls.listing_id = l.id AND sv.is_active AND sv.visibility <> 'internal'
        )
      )
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

CREATE OR REPLACE FUNCTION app_platform_reviews(p_search text, p_rating integer, p_limit integer, p_offset integer) RETURNS jsonb
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
      'visibility', r.visibility,
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

-- ---------------------------------------------------------------------------------------------------------------
-- 7. Grants: the public and tenant functions open to the runtime role and nobody else; the internal ones to no one
-- ---------------------------------------------------------------------------------------------------------------

REVOKE ALL ON FUNCTION app_marketplace_tokens(text[]) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_marketplace_match(text[], text, text, text, text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_insert_public_booking(uuid, uuid, text, text, uuid, text, text, text, date, time, time, text, text, text, text, text, text, text, timestamptz) FROM PUBLIC;
--> statement-breakpoint

REVOKE ALL ON FUNCTION app_review_is_public(public.reviews) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_reviewer_display_name(text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_public_marketplace_search(text[], text, text, text, text, integer, integer) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_public_marketplace_facets(text[], text, text, text, text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_public_marketplace_sitemap() FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_public_listing_booking(text, text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_public_create_marketplace_booking(text, text, text, date, time, time, text, text, text, text, text, text, text, text, text, timestamptz) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_listing_suspended() FROM PUBLIC;
--> statement-breakpoint

-- The reviewer's display name and the public-review predicate are pure; the workspace's own preview of the profile uses them on the business's own rows.
GRANT EXECUTE ON FUNCTION app_review_is_public(public.reviews) TO climvia_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_reviewer_display_name(text) TO climvia_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_public_marketplace_search(text[], text, text, text, text, integer, integer) TO climvia_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_public_marketplace_facets(text[], text, text, text, text) TO climvia_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_public_marketplace_sitemap() TO climvia_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_public_listing_booking(text, text) TO climvia_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_public_create_marketplace_booking(text, text, text, date, time, time, text, text, text, text, text, text, text, text, text, timestamptz) TO climvia_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_listing_suspended() TO climvia_app;

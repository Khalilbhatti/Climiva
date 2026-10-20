-- Public entry: review links and the customer's review, the platform's decisions about a public review, and a business's request to have a
-- suspended listing looked at again.
--
-- Hand-written (drizzle-kit does not manage functions or grants); 0026 is the generated half (columns, the new table, constraints). Read
-- docs/saas-architecture.md, "Public entry", first.
--
-- The rules, in one paragraph each
--   A review link. The business asks a customer for a review; the application makes a random 32-byte secret, shows the link to the business ONCE,
--   and stores only its SHA-256 (`review_requests.token_hash`). The customer opens `/review/<secret>`; the database hashes what it was given and finds
--   the request by that hash. The secret names the request and nothing else: the customer, the Job and the organization come from the request row,
--   never from anything the visitor sends. A link expires (`expires_at`), is used once (`status` = completed, and a review has at most one request),
--   and the business can replace a lost one (`app_reissue_review_link`; the old secret stops working). The runtime role has no UPDATE on
--   review_requests and no INSERT on reviews, so the public submission is the only way a customer's review is written by the application.
--   Public display is the customer's explicit choice (`p_public`), set here and nowhere else; nothing the business or the platform does makes a
--   private review public.
--   Review moderation. The platform may hide a PUBLIC review from every public Marketplace surface and restore it (`platform_review_moderation`;
--   no row means visible). `app_review_is_public` stays the ONE predicate behind the public profile, its rating and its count, so a hidden review
--   leaves all three at once and a restored one returns to all three. The review itself is never changed or deleted.
--   Suspension and its review. A suspension now carries what the business may be told (`tenant_message`, a different field from the internal
--   `reason`), when it began, and the business's request to have it looked at (none -> requested -> resolved as kept or lifted). A business asks with
--   `app_request_listing_review`; the request changes nothing about visibility. Only a platform administrator lifts a suspension.

-- ---------------------------------------------------------------------------------------------------------------
-- 1. Suspensions that already exist begin when they were decided
-- ---------------------------------------------------------------------------------------------------------------

UPDATE platform_listing_moderation SET suspended_at = decided_at WHERE state = 'suspended' AND suspended_at IS NULL;
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------------------------
-- 2. The one predicate for a review a visitor may see, narrowed by the platform's decision
-- ---------------------------------------------------------------------------------------------------------------

-- 0025's definition plus one condition: the platform has not hidden it. It must now read a table the runtime role cannot, so it is SECURITY DEFINER
-- (the planner no longer inlines it; the lookup is by primary key). It answers about the row it is given and returns nothing else.
CREATE OR REPLACE FUNCTION app_review_is_public(r public.reviews) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT r.visibility = 'public' AND r.source = 'Climvia'
     AND NOT EXISTS (SELECT 1 FROM public.platform_review_moderation m WHERE m.review_id = r.id AND m.state = 'hidden')
$$;
--> statement-breakpoint

-- The business's own question: which of MY reviews has the platform hidden from the Marketplace? Ids only; the reason stays internal.
CREATE FUNCTION app_hidden_review_ids() RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT m.review_id
    FROM public.platform_review_moderation m
    JOIN public.reviews r ON r.id = m.review_id
   WHERE m.state = 'hidden' AND r.organization_id = public.app_current_org_id() AND public.app_is_member(r.organization_id)
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------------------------
-- 3. Review links: the customer's side
-- ---------------------------------------------------------------------------------------------------------------

-- Internal: the hash a secret is stored under. The application computes the same value (SHA-256 of the UTF-8 text, as lowercase hex).
CREATE FUNCTION app_review_token_hash(p_token text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp
AS $$ SELECT encode(sha256(convert_to(p_token, 'UTF8')), 'hex') $$;
--> statement-breakpoint

-- What the review page needs, for a visitor who holds the secret: whether the link can still be used, whose review it is for, and the name the review
-- would be shown under. NULL for a secret that is not a link (wrong shape or unknown): a visitor cannot tell the two apart.
CREATE FUNCTION app_public_review_request(p_token text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  rq public.review_requests%ROWTYPE;
  business text;
  who text;
  link_state text;
BEGIN
  IF p_token IS NULL OR p_token !~ '^[A-Za-z0-9_-]{43}$' THEN RETURN NULL; END IF;
  SELECT * INTO rq FROM public.review_requests WHERE token_hash = public.app_review_token_hash(p_token);
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT o.name INTO business FROM public.organizations o WHERE o.id = rq.organization_id;
  link_state := CASE WHEN rq.status = 'completed' THEN 'completed' WHEN rq.expires_at <= now() THEN 'expired' ELSE 'open' END;
  IF link_state <> 'open' THEN RETURN jsonb_build_object('state', link_state, 'business', business); END IF;
  SELECT c.name INTO who FROM public.customers c WHERE c.organization_id = rq.organization_id AND c.id = rq.customer_id;
  RETURN jsonb_build_object('state', 'open', 'business', business, 'displayName', public.app_reviewer_display_name(who));
END
$$;
--> statement-breakpoint

-- The customer's review. One transaction: the request is locked, checked, answered and closed, so two submissions of the same link cannot both
-- write a review. The review's customer and Job are the request's; its date is the business's calendar date; its words are the customer's.
--   p_public is the customer's choice to let the review appear on the business's public Marketplace profile. false (or no choice) is a private review.
-- Returns { result: 'submitted' | 'completed' | 'expired' | 'invalid' }; content that does not fit the table's rules is an error (22023).
CREATE FUNCTION app_public_submit_review(p_token text, p_rating integer, p_text text, p_public boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  rq public.review_requests%ROWTYPE;
  zone text;
  clean text := btrim(coalesce(p_text, ''));
BEGIN
  IF p_token IS NULL OR p_token !~ '^[A-Za-z0-9_-]{43}$' THEN RETURN jsonb_build_object('result', 'invalid'); END IF;
  SELECT * INTO rq FROM public.review_requests WHERE token_hash = public.app_review_token_hash(p_token) FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('result', 'invalid'); END IF;
  IF rq.status = 'completed' THEN RETURN jsonb_build_object('result', 'completed'); END IF;
  IF rq.expires_at <= now() THEN RETURN jsonb_build_object('result', 'expired'); END IF;

  IF p_rating IS NULL OR p_rating NOT BETWEEN 1 AND 5 THEN RAISE EXCEPTION 'A rating from 1 to 5 is required.' USING ERRCODE = '22023'; END IF;
  IF char_length(clean) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'A review is between 1 and 2000 characters.' USING ERRCODE = '22023'; END IF;

  SELECT o.timezone INTO zone FROM public.organizations o WHERE o.id = rq.organization_id;
  INSERT INTO public.reviews (organization_id, slug, customer_id, job_id, source, rating, review_text, submitted_on, visibility, request_id)
  VALUES (
    rq.organization_id, 'rev-' || left(replace(gen_random_uuid()::text, '-', ''), 20), rq.customer_id, rq.job_id, 'Climvia', p_rating, clean,
    (now() AT TIME ZONE zone)::date, CASE WHEN coalesce(p_public, false) THEN 'public' ELSE 'private' END, rq.id
  );
  UPDATE public.review_requests SET status = 'completed', completed_at = now() WHERE id = rq.id;
  RETURN jsonb_build_object('result', 'submitted', 'public', coalesce(p_public, false));
END
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------------------------
-- 4. Review links: the business's side
-- ---------------------------------------------------------------------------------------------------------------

-- Replace the link of one of MY requests (the old secret stops working at once). The application made the new secret and sends only its hash; the
-- secret never reaches the database. Owners and admins only; a completed request has nothing left to ask for.
CREATE FUNCTION app_reissue_review_link(p_request uuid, p_token_hash text, p_expires_at timestamptz) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  org uuid := public.app_current_org_id();
  rq public.review_requests%ROWTYPE;
BEGIN
  IF org IS NULL OR public.app_current_user_id() IS NULL OR NOT public.app_has_role(org, ARRAY['owner', 'admin']) THEN
    RAISE EXCEPTION 'Only an owner or admin can make a review link.' USING ERRCODE = '42501';
  END IF;
  IF p_request IS NULL THEN RAISE EXCEPTION 'A request is required.' USING ERRCODE = '22023'; END IF;
  IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'The link is not valid.' USING ERRCODE = '22023'; END IF;
  IF p_expires_at IS NULL OR p_expires_at <= now() OR p_expires_at > now() + interval '90 days' THEN
    RAISE EXCEPTION 'A review link lasts up to 90 days.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO rq FROM public.review_requests WHERE organization_id = org AND id = p_request FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('found', false, 'changed', false); END IF;
  IF rq.status = 'completed' THEN RETURN jsonb_build_object('found', true, 'changed', false, 'reason', 'completed'); END IF;

  UPDATE public.review_requests SET token_hash = p_token_hash, expires_at = p_expires_at WHERE id = rq.id;
  RETURN jsonb_build_object('found', true, 'changed', true);
END
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------------------------
-- 5. A suspended listing: what the business may know, and asking for a second look
-- ---------------------------------------------------------------------------------------------------------------

-- NULL unless the platform has suspended MY listing. Otherwise only what is meant for the business: the platform's message to it, when the suspension
-- began, and where its request for a second look stands. The internal reason, who decided and the audit trail are not here.
CREATE FUNCTION app_listing_suspension() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'message', pm.tenant_message,
    'suspendedAt', pm.suspended_at,
    'reviewState', pm.review_state,
    'reviewRequestedAt', pm.review_requested_at,
    'reviewNote', pm.review_note,
    'reviewResolvedAt', pm.review_resolved_at,
    'reviewOutcome', pm.review_outcome
  )
    FROM public.marketplace_listings l
    JOIN public.platform_listing_moderation pm ON pm.listing_id = l.id AND pm.state = 'suspended'
   WHERE l.organization_id = public.app_current_org_id() AND public.app_is_member(l.organization_id)
$$;
--> statement-breakpoint

-- Ask the platform to look at the suspension again. Owners and admins only. It records the request and the member's words and changes nothing about
-- visibility. One request at a time, and after the platform keeps a suspension the business waits a day before asking again, so it cannot be spammed.
-- Returns { changed, result: 'requested' | 'not_suspended' | 'already_requested' | 'too_soon' }.
CREATE FUNCTION app_request_listing_review(p_note text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  org uuid := public.app_current_org_id();
  actor text := public.app_current_user_id();
  actor_email text;
  l public.marketplace_listings%ROWTYPE;
  cur public.platform_listing_moderation%ROWTYPE;
  note text := nullif(btrim(coalesce(p_note, '')), '');
BEGIN
  IF org IS NULL OR actor IS NULL OR NOT public.app_has_role(org, ARRAY['owner', 'admin']) THEN
    RAISE EXCEPTION 'Only an owner or admin can ask for a review of a suspension.' USING ERRCODE = '42501';
  END IF;
  IF note IS NOT NULL AND char_length(note) > 500 THEN RAISE EXCEPTION 'The note is too long.' USING ERRCODE = '22023'; END IF;

  SELECT * INTO l FROM public.marketplace_listings WHERE organization_id = org;
  IF NOT FOUND THEN RETURN jsonb_build_object('changed', false, 'result', 'not_suspended'); END IF;

  -- The same lock the platform takes when it decides, so a request and a decision about one listing happen one after the other.
  PERFORM pg_advisory_xact_lock(hashtextextended('platform-listing-moderation:' || l.id::text, 0));
  SELECT * INTO cur FROM public.platform_listing_moderation WHERE listing_id = l.id;
  IF NOT FOUND OR cur.state <> 'suspended' THEN RETURN jsonb_build_object('changed', false, 'result', 'not_suspended'); END IF;
  IF cur.review_state = 'requested' THEN RETURN jsonb_build_object('changed', false, 'result', 'already_requested'); END IF;
  IF cur.review_state = 'resolved' AND cur.review_outcome = 'kept' AND cur.review_resolved_at > now() - interval '24 hours' THEN
    RETURN jsonb_build_object('changed', false, 'result', 'too_soon', 'retryAfter', cur.review_resolved_at + interval '24 hours');
  END IF;

  UPDATE public.platform_listing_moderation
     SET review_state = 'requested', review_requested_at = now(), review_requested_by = actor, review_note = note, review_resolved_at = NULL, review_outcome = NULL
   WHERE listing_id = l.id;

  SELECT u.email INTO actor_email FROM public.auth_user u WHERE u.id = actor;
  INSERT INTO public.platform_audit_events (action, actor_kind, actor_user_id, actor_label, target_kind, target_id, reason, metadata)
  VALUES ('marketplace_listing.review_requested', 'organization_member', actor, coalesce(actor_email, actor), 'marketplace_listing', l.id::text, note,
          jsonb_build_object('organizationId', l.organization_id, 'publicSlug', l.public_slug));
  RETURN jsonb_build_object('changed', true, 'result', 'requested');
END
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------------------------
-- 6. Platform decisions about a listing (0023's function, with the business-facing message and the review lifecycle)
-- ---------------------------------------------------------------------------------------------------------------

-- Replaces the three-argument function: the optional fourth argument is the message for the business (never copied from the reason). Suspending
-- starts a fresh lifecycle (no request yet); allowing a listing again closes a pending request as lifted. Each decision and its audit events are
-- written in one transaction. Deciding what a listing already is changes nothing and records nothing.
DROP FUNCTION app_platform_set_listing_moderation(uuid, text, text);
--> statement-breakpoint
CREATE FUNCTION app_platform_set_listing_moderation(p_listing uuid, p_state text, p_reason text, p_tenant_message text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  actor text := public.app_current_user_id();
  actor_email text;
  l public.marketplace_listings%ROWTYPE;
  cur public.platform_listing_moderation%ROWTYPE;
  current_state text;
  had_request boolean;
  clean_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  clean_message text := nullif(btrim(coalesce(p_tenant_message, '')), '');
BEGIN
  PERFORM public.app_platform_guard();
  IF p_listing IS NULL THEN RAISE EXCEPTION 'A listing is required.' USING ERRCODE = '22023'; END IF;
  IF p_state IS NULL OR p_state NOT IN ('allowed', 'suspended') THEN RAISE EXCEPTION 'Unknown moderation state.' USING ERRCODE = '22023'; END IF;
  IF clean_reason IS NOT NULL AND char_length(clean_reason) > 500 THEN RAISE EXCEPTION 'The reason is too long.' USING ERRCODE = '22023'; END IF;
  IF clean_message IS NOT NULL AND char_length(clean_message) > 500 THEN RAISE EXCEPTION 'The message is too long.' USING ERRCODE = '22023'; END IF;
  IF p_state = 'allowed' THEN clean_reason := NULL; clean_message := NULL; END IF;

  -- Serialize decisions about one listing without blocking the business's own edits to it.
  PERFORM pg_advisory_xact_lock(hashtextextended('platform-listing-moderation:' || p_listing::text, 0));

  SELECT * INTO l FROM public.marketplace_listings WHERE id = p_listing;
  IF NOT FOUND THEN RETURN jsonb_build_object('found', false, 'changed', false); END IF;

  SELECT * INTO cur FROM public.platform_listing_moderation WHERE listing_id = p_listing;
  current_state := coalesce(cur.state, 'allowed');
  IF current_state = p_state THEN
    RETURN jsonb_build_object('found', true, 'changed', false, 'state', current_state);
  END IF;
  had_request := coalesce(cur.review_state, 'none') = 'requested';

  IF p_state = 'suspended' THEN
    INSERT INTO public.platform_listing_moderation AS m (listing_id, state, reason, tenant_message, suspended_at, decided_by, decided_at, revision)
    VALUES (p_listing, 'suspended', clean_reason, clean_message, now(), actor, now(), 1)
    ON CONFLICT (listing_id) DO UPDATE
      SET state = EXCLUDED.state, reason = EXCLUDED.reason, tenant_message = EXCLUDED.tenant_message, suspended_at = EXCLUDED.suspended_at,
          decided_by = EXCLUDED.decided_by, decided_at = EXCLUDED.decided_at, revision = m.revision + 1,
          review_state = 'none', review_requested_at = NULL, review_requested_by = NULL, review_note = NULL, review_resolved_at = NULL, review_outcome = NULL;
  ELSE
    UPDATE public.platform_listing_moderation
       SET state = 'allowed', reason = NULL, tenant_message = NULL, suspended_at = NULL, decided_by = actor, decided_at = now(), revision = revision + 1,
           review_state = CASE WHEN had_request THEN 'resolved' ELSE review_state END,
           review_resolved_at = CASE WHEN had_request THEN now() ELSE review_resolved_at END,
           review_outcome = CASE WHEN had_request THEN 'lifted' ELSE review_outcome END
     WHERE listing_id = p_listing;
  END IF;

  SELECT u.email INTO actor_email FROM public.auth_user u WHERE u.id = actor;
  INSERT INTO public.platform_audit_events (action, actor_kind, actor_user_id, actor_label, target_kind, target_id, reason, metadata)
  VALUES (
    CASE p_state WHEN 'suspended' THEN 'marketplace_listing.suspended' ELSE 'marketplace_listing.unsuspended' END,
    'platform_admin', actor, coalesce(actor_email, actor), 'marketplace_listing', p_listing::text, clean_reason,
    jsonb_build_object('organizationId', l.organization_id, 'publicSlug', l.public_slug, 'tenantStatus', l.status, 'previous', current_state)
      || CASE WHEN clean_message IS NOT NULL THEN jsonb_build_object('tenantMessage', clean_message) ELSE '{}'::jsonb END
  );
  IF p_state = 'allowed' AND had_request THEN
    -- The same decision, so the same transaction: stamped a moment later so the trail reads "allowed again", then "request answered".
    INSERT INTO public.platform_audit_events (occurred_at, action, actor_kind, actor_user_id, actor_label, target_kind, target_id, reason, metadata)
    VALUES (clock_timestamp(), 'marketplace_listing.review_resolved', 'platform_admin', actor, coalesce(actor_email, actor), 'marketplace_listing', p_listing::text, NULL,
            jsonb_build_object('organizationId', l.organization_id, 'publicSlug', l.public_slug, 'outcome', 'lifted'));
  END IF;
  RETURN jsonb_build_object('found', true, 'changed', true, 'state', p_state);
END
$$;
--> statement-breakpoint

-- Change what the business is told about a suspension that stands (or take the message away). The internal reason is untouched.
CREATE FUNCTION app_platform_update_listing_message(p_listing uuid, p_tenant_message text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  actor text := public.app_current_user_id();
  actor_email text;
  l public.marketplace_listings%ROWTYPE;
  cur public.platform_listing_moderation%ROWTYPE;
  clean_message text := nullif(btrim(coalesce(p_tenant_message, '')), '');
BEGIN
  PERFORM public.app_platform_guard();
  IF p_listing IS NULL THEN RAISE EXCEPTION 'A listing is required.' USING ERRCODE = '22023'; END IF;
  IF clean_message IS NOT NULL AND char_length(clean_message) > 500 THEN RAISE EXCEPTION 'The message is too long.' USING ERRCODE = '22023'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('platform-listing-moderation:' || p_listing::text, 0));
  SELECT * INTO l FROM public.marketplace_listings WHERE id = p_listing;
  IF NOT FOUND THEN RETURN jsonb_build_object('found', false, 'changed', false); END IF;
  SELECT * INTO cur FROM public.platform_listing_moderation WHERE listing_id = p_listing;
  IF NOT FOUND OR cur.state <> 'suspended' THEN RETURN jsonb_build_object('found', true, 'changed', false, 'state', 'allowed'); END IF;
  IF cur.tenant_message IS NOT DISTINCT FROM clean_message THEN RETURN jsonb_build_object('found', true, 'changed', false, 'state', 'suspended'); END IF;

  UPDATE public.platform_listing_moderation SET tenant_message = clean_message, revision = revision + 1 WHERE listing_id = p_listing;

  SELECT u.email INTO actor_email FROM public.auth_user u WHERE u.id = actor;
  INSERT INTO public.platform_audit_events (action, actor_kind, actor_user_id, actor_label, target_kind, target_id, reason, metadata)
  VALUES ('marketplace_listing.message_updated', 'platform_admin', actor, coalesce(actor_email, actor), 'marketplace_listing', p_listing::text, NULL,
          jsonb_build_object('organizationId', l.organization_id, 'publicSlug', l.public_slug)
            || CASE WHEN clean_message IS NOT NULL THEN jsonb_build_object('tenantMessage', clean_message) ELSE jsonb_build_object('cleared', true) END);
  RETURN jsonb_build_object('found', true, 'changed', true, 'state', 'suspended');
END
$$;
--> statement-breakpoint

-- Answer a business's request by KEEPING the suspension (lifting it is app_platform_set_listing_moderation with 'allowed'). The message to the business
-- may be updated in the same step, which is where the platform says why. Only a pending request can be answered.
CREATE FUNCTION app_platform_keep_listing_suspended(p_listing uuid, p_tenant_message text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  actor text := public.app_current_user_id();
  actor_email text;
  l public.marketplace_listings%ROWTYPE;
  cur public.platform_listing_moderation%ROWTYPE;
  clean_message text := nullif(btrim(coalesce(p_tenant_message, '')), '');
BEGIN
  PERFORM public.app_platform_guard();
  IF p_listing IS NULL THEN RAISE EXCEPTION 'A listing is required.' USING ERRCODE = '22023'; END IF;
  IF clean_message IS NOT NULL AND char_length(clean_message) > 500 THEN RAISE EXCEPTION 'The message is too long.' USING ERRCODE = '22023'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('platform-listing-moderation:' || p_listing::text, 0));
  SELECT * INTO l FROM public.marketplace_listings WHERE id = p_listing;
  IF NOT FOUND THEN RETURN jsonb_build_object('found', false, 'changed', false); END IF;
  SELECT * INTO cur FROM public.platform_listing_moderation WHERE listing_id = p_listing;
  IF NOT FOUND OR cur.state <> 'suspended' OR cur.review_state <> 'requested' THEN
    RETURN jsonb_build_object('found', true, 'changed', false, 'state', coalesce(cur.state, 'allowed'), 'reviewState', coalesce(cur.review_state, 'none'));
  END IF;

  UPDATE public.platform_listing_moderation
     SET review_state = 'resolved', review_resolved_at = now(), review_outcome = 'kept', tenant_message = coalesce(clean_message, tenant_message), revision = revision + 1
   WHERE listing_id = p_listing;

  SELECT u.email INTO actor_email FROM public.auth_user u WHERE u.id = actor;
  INSERT INTO public.platform_audit_events (action, actor_kind, actor_user_id, actor_label, target_kind, target_id, reason, metadata)
  VALUES ('marketplace_listing.review_resolved', 'platform_admin', actor, coalesce(actor_email, actor), 'marketplace_listing', p_listing::text, NULL,
          jsonb_build_object('organizationId', l.organization_id, 'publicSlug', l.public_slug, 'outcome', 'kept')
            || CASE WHEN clean_message IS NOT NULL THEN jsonb_build_object('tenantMessage', clean_message) ELSE '{}'::jsonb END);
  RETURN jsonb_build_object('found', true, 'changed', true, 'state', 'suspended', 'reviewState', 'resolved');
END
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------------------------
-- 7. Platform decisions about a public review
-- ---------------------------------------------------------------------------------------------------------------

-- Hide a PUBLIC review from the Marketplace, or restore it. A private review has nothing public to hide. The review row is never touched.
CREATE FUNCTION app_platform_set_review_moderation(p_review uuid, p_state text, p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  actor text := public.app_current_user_id();
  actor_email text;
  r public.reviews%ROWTYPE;
  current_state text;
  clean_reason text := nullif(btrim(coalesce(p_reason, '')), '');
BEGIN
  PERFORM public.app_platform_guard();
  IF p_review IS NULL THEN RAISE EXCEPTION 'A review is required.' USING ERRCODE = '22023'; END IF;
  IF p_state IS NULL OR p_state NOT IN ('visible', 'hidden') THEN RAISE EXCEPTION 'Unknown moderation state.' USING ERRCODE = '22023'; END IF;
  IF clean_reason IS NOT NULL AND char_length(clean_reason) > 500 THEN RAISE EXCEPTION 'The reason is too long.' USING ERRCODE = '22023'; END IF;
  IF p_state = 'visible' THEN clean_reason := NULL; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('platform-review-moderation:' || p_review::text, 0));

  SELECT * INTO r FROM public.reviews WHERE id = p_review;
  IF NOT FOUND THEN RETURN jsonb_build_object('found', false, 'changed', false); END IF;

  SELECT m.state INTO current_state FROM public.platform_review_moderation m WHERE m.review_id = p_review;
  current_state := coalesce(current_state, 'visible');
  IF current_state = p_state THEN RETURN jsonb_build_object('found', true, 'changed', false, 'state', current_state); END IF;
  IF p_state = 'hidden' AND r.visibility <> 'public' THEN
    RETURN jsonb_build_object('found', true, 'changed', false, 'state', current_state, 'reason', 'not_public');
  END IF;

  INSERT INTO public.platform_review_moderation AS m (review_id, state, reason, decided_by, decided_at, revision)
  VALUES (p_review, p_state, clean_reason, actor, now(), 1)
  ON CONFLICT (review_id) DO UPDATE
    SET state = EXCLUDED.state, reason = EXCLUDED.reason, decided_by = EXCLUDED.decided_by, decided_at = EXCLUDED.decided_at, revision = m.revision + 1;

  SELECT u.email INTO actor_email FROM public.auth_user u WHERE u.id = actor;
  INSERT INTO public.platform_audit_events (action, actor_kind, actor_user_id, actor_label, target_kind, target_id, reason, metadata)
  VALUES (
    CASE p_state WHEN 'hidden' THEN 'review.hidden' ELSE 'review.restored' END,
    'platform_admin', actor, coalesce(actor_email, actor), 'review', p_review::text, clean_reason,
    jsonb_build_object('organizationId', r.organization_id, 'reviewSlug', r.slug, 'rating', r.rating, 'previous', current_state)
  );
  RETURN jsonb_build_object('found', true, 'changed', true, 'state', p_state);
END
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------------------------
-- 8. The platform console's reads, extended again (0023 / 0025 bodies, plus the new facts)
-- ---------------------------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_platform_overview() RETURNS jsonb
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
    'pendingListingReviews', (SELECT count(*) FROM public.platform_listing_moderation WHERE state = 'suspended' AND review_state = 'requested'),
    'bookings', (SELECT count(*) FROM public.bookings),
    'reviews', (SELECT count(*) FROM public.reviews),
    'publicReviews', (SELECT count(*) FROM public.reviews WHERE visibility = 'public'),
    'hiddenReviews', (SELECT count(*) FROM public.platform_review_moderation WHERE state = 'hidden')
  );
END
$$;
--> statement-breakpoint

-- Listings with a pending request from the business come first, then the most recently changed.
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
  SELECT coalesce(jsonb_agg(x.j ORDER BY x.pending DESC, x.updated_at DESC, x.id), '[]'::jsonb) INTO found_rows FROM (
    SELECT l.id, l.updated_at, (coalesce(pm.state, 'allowed') = 'suspended' AND coalesce(pm.review_state, 'none') = 'requested') AS pending, jsonb_build_object(
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
      'moderation', jsonb_build_object(
        'state', coalesce(pm.state, 'allowed'), 'reason', pm.reason, 'decidedAt', pm.decided_at,
        'tenantMessage', pm.tenant_message, 'suspendedAt', pm.suspended_at,
        'reviewState', coalesce(pm.review_state, 'none'), 'reviewRequestedAt', pm.review_requested_at, 'reviewNote', pm.review_note,
        'reviewResolvedAt', pm.review_resolved_at, 'reviewOutcome', pm.review_outcome
      ),
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
    ORDER BY (coalesce(pm.state, 'allowed') = 'suspended' AND coalesce(pm.review_state, 'none') = 'requested') DESC, l.updated_at DESC, l.id
    LIMIT lim OFFSET off
  ) x;
  RETURN jsonb_build_object('total', total, 'rows', found_rows);
END
$$;
--> statement-breakpoint

-- A fifth, optional argument narrows the list: 'public' (the customer chose to show it), 'private', or 'hidden' (hidden by the platform).
DROP FUNCTION app_platform_reviews(text, integer, integer, integer);
--> statement-breakpoint
CREATE FUNCTION app_platform_reviews(p_search text, p_rating integer, p_limit integer, p_offset integer, p_visibility text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  pattern text := public.app_platform_like(p_search);
  lim integer := least(greatest(coalesce(p_limit, 25), 1), 100);
  off integer := greatest(coalesce(p_offset, 0), 0);
  vis text := CASE WHEN p_visibility IN ('public', 'private', 'hidden') THEN p_visibility END;
  total bigint;
  found_rows jsonb;
BEGIN
  PERFORM public.app_platform_guard();
  SELECT count(*) INTO total
    FROM public.reviews r
    JOIN public.organizations o ON o.id = r.organization_id
    LEFT JOIN public.customers c ON c.organization_id = r.organization_id AND c.id = r.customer_id
    LEFT JOIN public.platform_review_moderation rm ON rm.review_id = r.id
   WHERE (p_rating IS NULL OR r.rating = p_rating)
     AND (vis IS NULL OR (vis = 'public' AND r.visibility = 'public') OR (vis = 'private' AND r.visibility = 'private') OR (vis = 'hidden' AND rm.state = 'hidden'))
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
      'madePublicAt', r.made_public_at,
      'moderation', jsonb_build_object('state', coalesce(rm.state, 'visible'), 'reason', rm.reason, 'decidedAt', rm.decided_at),
      -- The one predicate the public profile, its rating and its count use.
      'eligible', public.app_review_is_public(r),
      'replied', EXISTS (SELECT 1 FROM public.review_replies rr WHERE rr.organization_id = r.organization_id AND rr.review_id = r.id)
    ) AS j
    FROM public.reviews r
    JOIN public.organizations o ON o.id = r.organization_id
    LEFT JOIN public.customers c ON c.organization_id = r.organization_id AND c.id = r.customer_id
    LEFT JOIN public.platform_review_moderation rm ON rm.review_id = r.id
    WHERE (p_rating IS NULL OR r.rating = p_rating)
      AND (vis IS NULL OR (vis = 'public' AND r.visibility = 'public') OR (vis = 'private' AND r.visibility = 'private') OR (vis = 'hidden' AND rm.state = 'hidden'))
      AND (pattern IS NULL OR o.name ILIKE pattern OR r.review_text ILIKE pattern OR coalesce(r.contact_name, c.name) ILIKE pattern)
    ORDER BY r.submitted_on DESC, r.id
    LIMIT lim OFFSET off
  ) x;
  RETURN jsonb_build_object('total', total, 'rows', found_rows);
END
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------------------------
-- 9. Grants: the new table to nobody; the public and tenant functions to the runtime role; the internal one to no one
-- ---------------------------------------------------------------------------------------------------------------

REVOKE ALL ON TABLE platform_review_moderation FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON TABLE platform_review_moderation FROM climvia_app;
--> statement-breakpoint

REVOKE ALL ON FUNCTION app_review_token_hash(text) FROM PUBLIC;
--> statement-breakpoint

REVOKE ALL ON FUNCTION app_hidden_review_ids() FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_public_review_request(text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_public_submit_review(text, integer, text, boolean) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_reissue_review_link(uuid, text, timestamptz) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_listing_suspension() FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_request_listing_review(text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_platform_set_listing_moderation(uuid, text, text, text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_platform_update_listing_message(uuid, text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_platform_keep_listing_suspended(uuid, text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_platform_set_review_moderation(uuid, text, text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_platform_reviews(text, integer, integer, integer, text) FROM PUBLIC;
--> statement-breakpoint

GRANT EXECUTE ON FUNCTION app_hidden_review_ids() TO climvia_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_public_review_request(text) TO climvia_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_public_submit_review(text, integer, text, boolean) TO climvia_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_reissue_review_link(uuid, text, timestamptz) TO climvia_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_listing_suspension() TO climvia_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_request_listing_review(text) TO climvia_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_platform_set_listing_moderation(uuid, text, text, text) TO climvia_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_platform_update_listing_message(uuid, text) TO climvia_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_platform_keep_listing_suspended(uuid, text) TO climvia_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_platform_set_review_moderation(uuid, text, text) TO climvia_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_platform_reviews(text, integer, integer, integer, text) TO climvia_app;

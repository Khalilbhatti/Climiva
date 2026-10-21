-- Customer acquisition: a business can add a customer, and a guest's booking becomes (or finds) the business's customer.
--
-- Hand-written, after 0028 (the identity key functions) and 0029 (the generated key columns, their indexes and the relaxed booking check).
--
-- 1. Adding a customer by hand. 0003 said "when an add flow ships, its migration adds the grant and the owner/admin policy together". This is that
--    migration, for `customers` ONLY: owners and admins of the ACTIVE organization may insert a customer of that organization; nothing else about
--    customers changes (no UPDATE, no DELETE, no write to notes, properties or equipment, and the key columns are generated, never written).
--
-- 2. A guest's booking. The two public booking functions (website and Marketplace) both write through app_insert_public_booking. It now finds or
--    creates the business's customer FIRST, in the same transaction, and the booking points at it. The function that does the finding,
--    app_resolve_public_customer, is internal: the runtime role cannot call it, and it takes the business from its caller (which found it from
--    a site or a listing), never from a request. The rule it applies, in order, inside ONE business and nowhere else:
--
--      a. email AND phone both given, and a customer has exactly that email and that phone        -> that customer
--      b. otherwise, the customers who have the booker's email or the booker's phone:
--           exactly one                                                                          -> that customer (same email, new phone / same phone, new email)
--           none                                                                                 -> a new customer, made from the booking
--           two or more (the email is one customer's and the phone another's, or several share  -> a new, SEPARATE customer carrying the booker's own email and
--           the phone)                                                                              phone; nothing is merged and nobody is picked. The next identical booking finds it by (a).
--      c. no usable email and no usable phone, or an ambiguity with only one of the two to go on  -> no customer; the booking keeps the visitor's contact details
--
--    A name is never used to find anyone, and a customer that is found is never changed: the booker's name, phone and email are written ONLY on a
--    customer this function creates. The answer a visitor gets does not depend on any of this (it says whether the booking was made, as before).
--
--    Per business, one customer at a time is made: a transaction-scoped advisory lock keyed by the organization, taken by this function and by the
--    "Add customer" action, so two people booking at once, or a person booking while an owner adds the same customer, find the same row rather
--    than each making one. The unique index on (organization, email, phone) from 0029 is the backstop for anything that does not take the lock.
--
--    A booking for a customer carries neither phone nor email (0029): they are the customer's. It does keep the address the visit was requested at.
--    When what the booker typed differs from the customer found (another name, another phone, another email), the booking's note begins
--    "Booked as <name>, <phone>, <email>." so that nothing a visitor typed is lost and the customer is not changed.
--
--    Bookings made before this migration have no customer and are NOT guessed at: nothing here looks backwards.

-- ---------------------------------------------------------------------------------------------------------------
-- 1. Adding a customer by hand
-- ---------------------------------------------------------------------------------------------------------------

CREATE POLICY customers_insert ON customers FOR INSERT TO climvia_app
  WITH CHECK (organization_id = app_current_org_id() AND app_has_role(organization_id, ARRAY['owner', 'admin']));
--> statement-breakpoint

-- INSERT is table-wide because Drizzle names every column it writes; the generated key columns are never named.
GRANT INSERT ON customers TO climvia_app;
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------------------------
-- 2. A guest's booking finds or creates the business's customer
-- ---------------------------------------------------------------------------------------------------------------

CREATE FUNCTION app_resolve_public_customer(p_organization_id uuid, p_name text, p_phone text, p_email text) RETURNS uuid
LANGUAGE plpgsql SET search_path = public, pg_temp
AS $$
DECLARE
  ekey text := public.app_email_key(p_email);
  pkey text := public.app_phone_key(p_phone);
  both_keys boolean := (public.app_email_key(p_email) IS NOT NULL AND public.app_phone_key(p_phone) IS NOT NULL);
  matched uuid;
  candidates uuid[];
  created uuid;
  base text;
  new_slug text;
  suffix integer := 1;
  shown_phone text;
BEGIN
  -- Nothing to recognise a person by: no customer (the booking keeps the visitor's contact details).
  IF p_organization_id IS NULL OR (ekey IS NULL AND pkey IS NULL) THEN RETURN NULL; END IF;

  -- One at a time per business (held to the end of the transaction, which is also the booking's).
  PERFORM pg_advisory_xact_lock(pg_catalog.hashtextextended('climvia.customer-identity:' || p_organization_id::text, 0));

  -- a. The exact identity.
  IF both_keys THEN
    SELECT c.id INTO matched FROM public.customers c WHERE c.organization_id = p_organization_id AND c.email_key = ekey AND c.phone_key = pkey;
    IF FOUND THEN RETURN matched; END IF;
  END IF;

  -- b. Anyone in this business who shares the email or the phone.
  SELECT array_agg(c.id ORDER BY c."position") INTO candidates FROM public.customers c
   WHERE c.organization_id = p_organization_id
     AND ((ekey IS NOT NULL AND c.email_key = ekey) OR (pkey IS NOT NULL AND c.phone_key = pkey));
  IF coalesce(cardinality(candidates), 0) = 1 THEN RETURN candidates[1]; END IF;
  -- c. Several candidates and only one thing to tell them apart by: a new customer could never be found again, so make none.
  IF coalesce(cardinality(candidates), 0) > 1 AND NOT both_keys THEN RETURN NULL; END IF;

  -- None, or a conflict with both email and phone to carry: a new customer from the booking.
  base := regexp_replace(lower(normalize(btrim(p_name), NFKD)), '[̀-ͯ]', '', 'g');
  base := regexp_replace(base, '[^a-z0-9]+', '-', 'g');
  base := regexp_replace(regexp_replace(base, '^-+', ''), '-+$', '');
  base := regexp_replace(left(base, 50), '-+$', '');
  IF base = '' THEN base := 'customer'; END IF;
  new_slug := base;
  WHILE EXISTS (SELECT 1 FROM public.customers c WHERE c.organization_id = p_organization_id AND c.slug = new_slug) LOOP
    suffix := suffix + 1;
    new_slug := base || '-' || suffix;
  END LOOP;

  -- A ten-digit phone is stored the way Settings stores one: (555) 010-0100.
  shown_phone := CASE
    WHEN pkey IS NOT NULL AND length(pkey) = 10 THEN '(' || left(pkey, 3) || ') ' || substr(pkey, 4, 3) || '-' || right(pkey, 4)
    ELSE nullif(btrim(coalesce(p_phone, '')), '')
  END;

  BEGIN
    INSERT INTO public.customers (organization_id, slug, name, phone, email)
    VALUES (p_organization_id, new_slug, btrim(p_name), shown_phone, nullif(btrim(coalesce(p_email, '')), ''))
    RETURNING id INTO created;
  EXCEPTION WHEN unique_violation THEN
    -- The same email and phone written by something that does not take the lock (an import by the operator) is the customer.
    IF both_keys THEN
      SELECT c.id INTO created FROM public.customers c WHERE c.organization_id = p_organization_id AND c.email_key = ekey AND c.phone_key = pkey;
    END IF;
    IF created IS NULL THEN RAISE; END IF;
  END;
  RETURN created;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_resolve_public_customer(uuid, text, text, text) FROM PUBLIC;
--> statement-breakpoint

-- The one place a public booking is written (0025's, now finding the customer first). INTERNAL, exactly as before; the signature, the answers and the order
-- of the checks are unchanged, and a repeat of a booking still returns the booking it made without making a customer.
CREATE OR REPLACE FUNCTION app_insert_public_booking(
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
  booker uuid;
  booker_name text;
  booker_email_key text;
  booker_phone_key text;
  booking_note text;
  v_email_key text := public.app_email_key(p_contact_email);
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
  -- The same person asking for the same Service at the same time again (a booking of a customer holds the email on the customer).
  SELECT b.* INTO existing FROM public.bookings b
   WHERE b.organization_id = p_organization_id AND b.source = p_source AND b.service_id = p_service_id AND b.service_date = p_service_date AND b.start_time = p_start
     AND b.status IN ('pending', 'confirmed')
     AND (lower(b.contact_email) = lower(p_contact_email)
          OR (v_email_key IS NOT NULL AND EXISTS (SELECT 1 FROM public.customers c WHERE c.organization_id = b.organization_id AND c.id = b.customer_id AND c.email_key = v_email_key)))
   ORDER BY b.number LIMIT 1;
  IF FOUND THEN RETURN jsonb_build_object('ok', true, 'duplicate', true, 'number', existing.number, 'status', existing.status); END IF;

  new_status := CASE p_booking_method WHEN 'instant' THEN 'confirmed' ELSE 'pending' END;
  -- A business's counter starts at 1001 and walks past numbers already stored (a baseline booking may hold one).
  LOOP
    new_number := public.app_take_number(p_organization_id, 'booking');
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.bookings b WHERE b.organization_id = p_organization_id AND b.number = new_number);
  END LOOP;

  -- The business's customer for this booker (see the rule at the top of this migration). Null only when there is nothing to recognise them by.
  booker := public.app_resolve_public_customer(p_organization_id, p_contact_name, p_contact_phone, p_contact_email);
  booking_note := nullif(btrim(coalesce(p_note, '')), '');
  IF booker IS NOT NULL THEN
    SELECT c.name, c.email_key, c.phone_key INTO booker_name, booker_email_key, booker_phone_key
      FROM public.customers c WHERE c.organization_id = p_organization_id AND c.id = booker;
    IF lower(regexp_replace(btrim(booker_name), '[[:space:]]+', ' ', 'g')) <> lower(regexp_replace(btrim(p_contact_name), '[[:space:]]+', ' ', 'g'))
       OR v_email_key IS DISTINCT FROM booker_email_key OR public.app_phone_key(p_contact_phone) IS DISTINCT FROM booker_phone_key THEN
      booking_note := 'Booked as ' || btrim(p_contact_name) || ', ' || btrim(p_contact_phone) || ', ' || btrim(p_contact_email) || '.' || coalesce(' ' || booking_note, '');
    END IF;
  END IF;

  INSERT INTO public.bookings (
    organization_id, number, customer_id, property_id, service_id, assignee_id, contact_name, contact_phone, contact_email, contact_address,
    source, marketplace_listing_id, discovery_service, discovery_location,
    status, service_date, start_time, end_time, note, intake_system_type, intake_reported_issue, submission_key, received_at, confirmed_at
  ) VALUES (
    p_organization_id, new_number, booker, NULL, p_service_id, NULL,
    CASE WHEN booker IS NULL THEN btrim(p_contact_name) END, CASE WHEN booker IS NULL THEN btrim(p_contact_phone) END,
    CASE WHEN booker IS NULL THEN btrim(p_contact_email) END, btrim(p_contact_address),
    p_source, p_listing_id, p_discovery_service, p_discovery_location,
    new_status, p_service_date, p_start, p_end, booking_note, nullif(btrim(coalesce(p_intake_system_type, '')), ''),
    nullif(btrim(coalesce(p_intake_reported_issue, '')), ''), p_submission_key, coalesce(p_received_at, now()), CASE WHEN new_status = 'confirmed' THEN coalesce(p_received_at, now()) END
  );
  RETURN jsonb_build_object('ok', true, 'duplicate', false, 'number', new_number, 'status', new_status);
END
$$;

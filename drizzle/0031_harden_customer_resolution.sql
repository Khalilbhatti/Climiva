-- Harden customer identity resolution: a new email is never attached to somebody else's customer because of a phone number.
--
-- Hand-written; no schema change. It replaces the BODY of app_resolve_public_customer (0030), keeping its name and signature, so its privileges stay as 0030 set
-- them (nobody but its owner and the booking function that calls it). Migration 0030 itself is not touched.
--
-- Why. 0030 treated "the only customer who has this phone, with an email nobody has" as the same person. A phone number is shared by households, by a family's
-- landline, by an office's front desk: a different person's email on a known phone is not evidence of the same person. The rule below puts the email first.
--
-- The rule, inside ONE business and nowhere else (every lookup names the organization first):
--
--   A. an email is given and exactly one customer has it  -> that customer, UNLESS the phone given positively belongs to a different customer (then C).
--                                                            A new or changed phone alone changes nothing and is never written to the customer.
--   B. an email is given and NO customer has it            -> a new, separate customer, even if the phone belongs to someone.
--   C. the email is one customer's and the phone another's -> a new, separate customer. Nobody is merged.
--      (An email several customers have: a new, separate customer carrying what was typed when there is a phone to tell it apart by; with no phone,
--      nobody can be told apart and the booking keeps the visitor's details.)
--   D. no usable email, a phone is given                   -> the one customer who has that phone; if several have it, the one among them who has NO email
--                                                            (the separate customer an earlier booking made for it), and if there is none, a new, separate customer.
--   E. neither a usable email nor a usable phone           -> no customer; the booking keeps the visitor's details.
--   The exact identity first: the same email AND the same phone is that customer, whatever else is true.
--
-- A name never finds anyone, and a customer that is found is never changed. The answer a visitor receives does not depend on any of this.

CREATE OR REPLACE FUNCTION app_resolve_public_customer(p_organization_id uuid, p_name text, p_phone text, p_email text) RETURNS uuid
LANGUAGE plpgsql SET search_path = public, pg_temp
AS $$
DECLARE
  ekey text := public.app_email_key(p_email);
  pkey text := public.app_phone_key(p_phone);
  both_keys boolean := (public.app_email_key(p_email) IS NOT NULL AND public.app_phone_key(p_phone) IS NOT NULL);
  matched uuid;
  email_matches uuid[];
  phone_matches uuid[];
  phone_only uuid[];
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

  -- The exact identity: the same email and the same phone.
  IF both_keys THEN
    SELECT c.id INTO matched FROM public.customers c WHERE c.organization_id = p_organization_id AND c.email_key = ekey AND c.phone_key = pkey;
    IF FOUND THEN RETURN matched; END IF;
  END IF;

  IF ekey IS NOT NULL THEN
    SELECT array_agg(c.id ORDER BY c."position") INTO email_matches FROM public.customers c WHERE c.organization_id = p_organization_id AND c.email_key = ekey;
    IF cardinality(email_matches) = 1 THEN
      -- A. One customer has this email. A phone that is nobody's, or none, changes nothing; a phone that is another customer's is a conflict (C).
      IF pkey IS NULL OR NOT EXISTS (
           SELECT 1 FROM public.customers c WHERE c.organization_id = p_organization_id AND c.phone_key = pkey AND c.id <> email_matches[1]
         ) THEN
        RETURN email_matches[1];
      END IF;
    ELSIF cardinality(email_matches) > 1 AND NOT both_keys THEN
      -- Several customers have this email and there is no phone to tell them apart: a new customer could never be found again.
      RETURN NULL;
    END IF;
    -- B (nobody has the email), C (a conflict), or an email several have with a phone to carry: a new, separate customer below.
  ELSE
    -- D. No usable email.
    SELECT array_agg(c.id ORDER BY c."position"), array_agg(c.id ORDER BY c."position") FILTER (WHERE c.email_key IS NULL)
      INTO phone_matches, phone_only
      FROM public.customers c WHERE c.organization_id = p_organization_id AND c.phone_key = pkey;
    IF cardinality(phone_matches) = 1 THEN RETURN phone_matches[1]; END IF;
    IF cardinality(phone_matches) > 1 AND cardinality(phone_only) = 1 THEN RETURN phone_only[1]; END IF;
  END IF;

  -- A new, separate customer, carrying what the booker typed.
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

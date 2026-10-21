-- Customer identity keys: the ONE definition of "the same email" and "the same phone".
--
-- Hand-written, and deliberately before the schema change that uses it (0029 adds two generated columns on `customers` that call these functions).
-- A booking is matched to a customer on these two keys, so the stored column and the booking function must read them from the same place:
-- two spellings of the rule would, sooner or later, disagree.
--
--   app_email_key(email)   the address without surrounding space, in lower case; null when nothing is left.
--   app_phone_key(phone)   the digits only. A US number is its ten digits (a leading country code 1 is dropped, exactly as Settings' normalizePhone does),
--                          anything else is its digits as they are; fewer than seven digits is NOT an identity and the key is null. So
--                          "(555) 010-0100", "555.010.0100", "+1 555 010 0100" and "15550100100" are one phone, and "555 0100" is another.
--
-- Pure, IMMUTABLE and with no table or setting behind them, so PostgreSQL may build a generated column and an index on them; every name is
-- schema-qualified so that a restore, which runs with an empty search path, reads them the same way.

CREATE FUNCTION app_email_key(p_email text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT nullif(pg_catalog.lower(pg_catalog.btrim(p_email)), '')
$$;
--> statement-breakpoint

CREATE FUNCTION app_phone_key(p_phone text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN x.digits ~ '^1[0-9]{10}$' THEN pg_catalog.right(x.digits, 10)
    WHEN pg_catalog.length(x.digits) >= 7 THEN x.digits
  END
  FROM (SELECT pg_catalog.regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g') AS digits) AS x
$$;
--> statement-breakpoint

-- The runtime role evaluates them when it inserts a customer (the generated columns), nobody else has a reason to.
REVOKE ALL ON FUNCTION app_email_key(text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_phone_key(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_email_key(text) TO climvia_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_phone_key(text) TO climvia_app;

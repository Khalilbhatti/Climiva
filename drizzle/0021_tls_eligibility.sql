-- May a certificate be requested for this name? (Phase 18C1)
--
-- The reverse proxy (Caddy) serves customers' domains with certificates it obtains ON DEMAND, the first time a name is requested. It asks the
-- application first, so an arbitrary name pointed at the server can not make it request a certificate from a public CA. The application asks
-- the database this one question, and answers with a status code only.
--
-- Same philosophy as the other public functions (0013, 0018, 0020): SECURITY DEFINER, a fixed search_path, executable by the runtime role and by
-- nobody else, and an answer that holds nothing. It is true only for the exact NORMALIZED name of an ACTIVE claim whose Site is PUBLISHED: a
-- pending, verified, disabled or removed claim, a private Site and an unknown name are all false. Nothing about the claim, its Site or its business
-- is returned, and no DNS is consulted: ownership was proved when the claim was verified, and a handshake must not wait on the network.
CREATE FUNCTION app_tls_eligible(p_hostname text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT p_hostname IS NOT NULL AND char_length(p_hostname) <= 231 AND EXISTS (
    SELECT 1
      FROM public.site_domains d
      JOIN public.sites s ON s.organization_id = d.organization_id AND s.id = d.site_id
     WHERE d.hostname = p_hostname AND d.status = 'active' AND s.status = 'published' AND s.published_version_id IS NOT NULL
  )
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_tls_eligible(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_tls_eligible(text) TO climvia_app;

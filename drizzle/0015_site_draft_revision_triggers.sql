-- A Draft's revision: a counter that goes up on EVERY change to a Draft (its theme, settings, pages or sections), however it was made.
--
-- The Website Builder opens a Draft at some revision and sends that number back when it saves or publishes. If the stored Draft has moved
-- on (a second tab saved, another person published a different state), the numbers differ and the request is refused, so a tab that is
-- behind can never silently overwrite what another one saved. The counter is kept by triggers rather than by each write path so that no
-- path, present or future (a template replaced onto a Draft, an import), can change a Draft without moving it.
--
-- Only a DRAFT has a meaningful revision: a Published version never changes (0013), so its counter stays where it was created.
-- The runtime role has no UPDATE privilege on the column; only these triggers move it.

-- A change to the version row itself (its theme, settings or template).
CREATE FUNCTION site_versions_bump_revision() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'draft' AND NEW.revision = OLD.revision
     AND (NEW.theme IS DISTINCT FROM OLD.theme OR NEW.settings IS DISTINCT FROM OLD.settings OR NEW.template_id IS DISTINCT FROM OLD.template_id) THEN
    NEW.revision := OLD.revision + 1;
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER site_versions_bump_revision BEFORE UPDATE ON site_versions FOR EACH ROW EXECUTE FUNCTION site_versions_bump_revision();
--> statement-breakpoint

-- A change to a page or a section of a Draft. The version row is not the caller's to update (the runtime role may only change its theme,
-- settings and template), so this runs as the owner, like the other definer functions; it touches only Draft versions, by id.
CREATE FUNCTION site_draft_touch() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  version_id uuid;
BEGIN
  version_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.site_version_id ELSE NEW.site_version_id END;
  UPDATE public.site_versions SET revision = revision + 1 WHERE id = version_id AND status = 'draft';
  RETURN NULL;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION site_draft_touch() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER site_pages_touch_draft AFTER INSERT OR UPDATE OR DELETE ON site_pages FOR EACH ROW EXECUTE FUNCTION site_draft_touch();
--> statement-breakpoint
CREATE TRIGGER site_sections_touch_draft AFTER INSERT OR UPDATE OR DELETE ON site_sections FOR EACH ROW EXECUTE FUNCTION site_draft_touch();

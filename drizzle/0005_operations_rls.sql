-- Tenant isolation, grants and integrity for operations: bookings, jobs, job file metadata, schedule blocks and the
-- numbering counters.
--
-- Hand-written, like 0001 and 0003, and built from the SAME pieces: the transaction-local context (app.user_id /
-- app.org_id) and the SECURITY DEFINER membership checks defined in 0001. Nothing here is a second isolation pattern.
--
-- The rules, per table
--   bookings, jobs
--       Members of the ACTIVE organization read them. Owners and admins of the ACTIVE organization create and change them.
--       Nobody deletes them: history is kept, a booking is cancelled and a job is completed. The runtime role may only
--       change the columns a screen changes (see the grants), and a trigger holds the allowed status changes.
--   job_files
--       Members read the metadata; owners and admins change its visibility. Nothing can be added through the application
--       until an object store exists (the file CONTENT is never in PostgreSQL), so there is no INSERT grant.
--   schedule_blocks, schedule_block_members, organization_sequences
--       Members read them. No flow writes a block yet, and a number is taken only through app_next_number().
--
-- Cross-organization references are impossible rather than merely checked: every child reaches its parent through a
-- composite (organization_id, id) foreign key (see 0004), and PostgreSQL's referential checks run outside Row Level Security.

-- ---------------------------------------------------------------------------------------------------------------
-- 1. Row Level Security policies (RLS is already ENABLED on each table by 0004)
-- ---------------------------------------------------------------------------------------------------------------

CREATE POLICY bookings_select ON bookings FOR SELECT TO climvia_app
  USING (organization_id = app_current_org_id() AND app_is_member(organization_id));
--> statement-breakpoint
CREATE POLICY bookings_insert ON bookings FOR INSERT TO climvia_app
  WITH CHECK (organization_id = app_current_org_id() AND app_has_role(organization_id, ARRAY['owner', 'admin']));
--> statement-breakpoint
CREATE POLICY bookings_update ON bookings FOR UPDATE TO climvia_app
  USING (organization_id = app_current_org_id() AND app_has_role(organization_id, ARRAY['owner', 'admin']))
  WITH CHECK (organization_id = app_current_org_id() AND app_has_role(organization_id, ARRAY['owner', 'admin']));
--> statement-breakpoint

CREATE POLICY jobs_select ON jobs FOR SELECT TO climvia_app
  USING (organization_id = app_current_org_id() AND app_is_member(organization_id));
--> statement-breakpoint
CREATE POLICY jobs_insert ON jobs FOR INSERT TO climvia_app
  WITH CHECK (organization_id = app_current_org_id() AND app_has_role(organization_id, ARRAY['owner', 'admin']));
--> statement-breakpoint
CREATE POLICY jobs_update ON jobs FOR UPDATE TO climvia_app
  USING (organization_id = app_current_org_id() AND app_has_role(organization_id, ARRAY['owner', 'admin']))
  WITH CHECK (organization_id = app_current_org_id() AND app_has_role(organization_id, ARRAY['owner', 'admin']));
--> statement-breakpoint

CREATE POLICY job_files_select ON job_files FOR SELECT TO climvia_app
  USING (organization_id = app_current_org_id() AND app_is_member(organization_id));
--> statement-breakpoint
CREATE POLICY job_files_update ON job_files FOR UPDATE TO climvia_app
  USING (organization_id = app_current_org_id() AND app_has_role(organization_id, ARRAY['owner', 'admin']))
  WITH CHECK (organization_id = app_current_org_id() AND app_has_role(organization_id, ARRAY['owner', 'admin']));
--> statement-breakpoint

CREATE POLICY schedule_blocks_select ON schedule_blocks FOR SELECT TO climvia_app
  USING (organization_id = app_current_org_id() AND app_is_member(organization_id));
--> statement-breakpoint
CREATE POLICY schedule_block_members_select ON schedule_block_members FOR SELECT TO climvia_app
  USING (organization_id = app_current_org_id() AND app_is_member(organization_id));
--> statement-breakpoint
CREATE POLICY organization_sequences_select ON organization_sequences FOR SELECT TO climvia_app
  USING (organization_id = app_current_org_id() AND app_is_member(organization_id));
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------------------------
-- 2. Grants: least privilege for the runtime role. Ids, numbers, organization_id and the people on a record are never rewritten.
-- ---------------------------------------------------------------------------------------------------------------

-- INSERT is table-wide because Drizzle names every column in an INSERT (unset ones as DEFAULT); UPDATE is per column.
GRANT SELECT, INSERT ON bookings, jobs TO climvia_app;
--> statement-breakpoint
-- A booking is confirmed, cancelled, completed (with its job) or assigned: nothing else about it changes.
GRANT UPDATE (status, assignee_id, confirmed_at, cancellation_reason) ON bookings TO climvia_app;
--> statement-breakpoint
-- A job is assigned, started, has its work details written and is completed.
GRANT UPDATE (assignee_id, status, technician_diagnosis, work_performed, customer_summary, internal_notes, completion_notes, completed_at)
  ON jobs TO climvia_app;
--> statement-breakpoint
GRANT SELECT ON job_files, schedule_blocks, schedule_block_members, organization_sequences TO climvia_app;
--> statement-breakpoint
GRANT UPDATE (visibility) ON job_files TO climvia_app;
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------------------------
-- 3. Numbering: BK-1042 and JB-204 are allocated, never computed with MAX(number) + 1
-- ---------------------------------------------------------------------------------------------------------------

-- Takes the next number of one kind for the ACTIVE organization. SECURITY DEFINER because the runtime role has no
-- UPDATE on the counters, so it can neither move one nor reach another business's. The UPDATE locks the counter row until
-- the caller's transaction ends, which serializes concurrent allocations in one organization, and a rolled-back
-- transaction gives its number back. The organization comes from the verified context, never from an argument.
CREATE FUNCTION app_next_number(p_kind text) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  org uuid := public.app_current_org_id();
  allocated integer;
BEGIN
  IF org IS NULL OR NOT public.app_has_role(org, ARRAY['owner', 'admin']) THEN
    RAISE EXCEPTION 'Not allowed to allocate numbers for this organization' USING ERRCODE = '42501';
  END IF;
  -- A business starts at 1001. Existing businesses get their counter the first time they need one.
  INSERT INTO public.organization_sequences (organization_id, kind, next_value) VALUES (org, p_kind, 1001)
    ON CONFLICT (organization_id, kind) DO NOTHING;
  UPDATE public.organization_sequences
     SET next_value = next_value + 1, updated_at = now()
   WHERE organization_id = org AND kind = p_kind
  RETURNING next_value - 1 INTO allocated;
  RETURN allocated;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_next_number(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_next_number(text) TO climvia_app;
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------------------------
-- 4. Integrity the constraints cannot express: status changes only go forward
-- ---------------------------------------------------------------------------------------------------------------

-- pending -> confirmed | cancelled; confirmed -> completed | cancelled. Completed and cancelled are final: nothing about
-- them changes again. A booking that already has a job cannot be cancelled (the job has no cancelled state).
CREATE FUNCTION bookings_guard_transition() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status IN ('completed', 'cancelled') THEN
    RAISE EXCEPTION 'A % booking is final and cannot be changed', OLD.status
      USING ERRCODE = '23514', CONSTRAINT = 'bookings_final';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
       (OLD.status = 'pending' AND NEW.status IN ('confirmed', 'cancelled'))
    OR (OLD.status = 'confirmed' AND NEW.status IN ('completed', 'cancelled'))
  ) THEN
    RAISE EXCEPTION 'A % booking cannot become %', OLD.status, NEW.status
      USING ERRCODE = '23514', CONSTRAINT = 'bookings_status_transition';
  END IF;
  IF NEW.status = 'cancelled' AND EXISTS (SELECT 1 FROM public.jobs j WHERE j.organization_id = NEW.organization_id AND j.booking_id = NEW.id) THEN
    RAISE EXCEPTION 'A booking that already has a job cannot be cancelled'
      USING ERRCODE = '23514', CONSTRAINT = 'bookings_cancel_with_job';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER bookings_guard_transition BEFORE UPDATE ON bookings FOR EACH ROW EXECUTE FUNCTION bookings_guard_transition();
--> statement-breakpoint

-- scheduled -> in-progress -> completed. A completed job is final: it never returns to scheduled and its record is not rewritten.
CREATE FUNCTION jobs_guard_transition() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status = 'completed' THEN
    RAISE EXCEPTION 'A completed job is final and cannot be changed'
      USING ERRCODE = '23514', CONSTRAINT = 'jobs_final';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
       (OLD.status = 'scheduled' AND NEW.status = 'in-progress')
    OR (OLD.status = 'in-progress' AND NEW.status = 'completed')
  ) THEN
    RAISE EXCEPTION 'A % job cannot become %', OLD.status, NEW.status
      USING ERRCODE = '23514', CONSTRAINT = 'jobs_status_transition';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER jobs_guard_transition BEFORE UPDATE ON jobs FOR EACH ROW EXECUTE FUNCTION jobs_guard_transition();
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------------------------
-- 5. updated_at maintenance (set_updated_at is defined in 0001)
-- ---------------------------------------------------------------------------------------------------------------

CREATE TRIGGER bookings_set_updated_at BEFORE UPDATE ON bookings FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER jobs_set_updated_at BEFORE UPDATE ON jobs FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER job_files_set_updated_at BEFORE UPDATE ON job_files FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER schedule_blocks_set_updated_at BEFORE UPDATE ON schedule_blocks FOR EACH ROW EXECUTE FUNCTION set_updated_at();

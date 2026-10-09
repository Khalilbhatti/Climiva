-- Tenant isolation, grants and integrity for Maintenance Plans and Reviews.
--
-- Hand-written, like 0001, 0003, 0005 and 0007, and built from the SAME pieces: the transaction-local context (app.user_id /
-- app.org_id) and the SECURITY DEFINER membership checks defined in 0001. Nothing here is a second isolation pattern.
--
-- The rules, per table
--   maintenance_plans
--       Members of the ACTIVE organization read them. Owners and admins create them, never as "imported" (only the seed carries
--       history in). A plan is not rewritten after it is created: it has no UPDATE privilege at all. Nobody deletes.
--   maintenance_plan_coverage, maintenance_plan_visits
--       Members read. Owners and admins add rows ONLY in the transaction that created the plan, so a plan can never gain or
--       lose coverage or a visit later. A visit then changes only its status, its booking and its completion day (UPDATE of
--       those three columns), and only the way the guard below allows. Nobody deletes.
--   reviews
--       Members read. NOBODY writes through the application: customers write reviews (the public way to do that comes with the
--       Website), and the business only replies. The seed writes the sample history.
--   review_replies
--       Members read. Owners and admins post the one response a review has and edit its text; nothing else about a reply changes.
--   review_requests
--       Members read. Owners and admins record a request (about a COMPLETED job when it names one; one active request per job).
--       A request is a record only: nothing is sent. Never updated, never deleted.
--
-- Cross-organization references are impossible rather than merely checked: every child reaches its parent through a composite
-- (organization_id, id) foreign key (see 0008), and PostgreSQL's referential checks run outside Row Level Security.

-- ---------------------------------------------------------------------------------------------------------------
-- 1. Row Level Security policies (RLS is already ENABLED on each table by 0008)
-- ---------------------------------------------------------------------------------------------------------------

CREATE POLICY maintenance_plans_select ON maintenance_plans FOR SELECT TO climvia_app
  USING (organization_id = app_current_org_id() AND app_is_member(organization_id));
--> statement-breakpoint
CREATE POLICY maintenance_plans_insert ON maintenance_plans FOR INSERT TO climvia_app
  WITH CHECK (organization_id = app_current_org_id() AND app_has_role(organization_id, ARRAY['owner', 'admin']) AND NOT imported);
--> statement-breakpoint

CREATE POLICY maintenance_plan_coverage_select ON maintenance_plan_coverage FOR SELECT TO climvia_app
  USING (organization_id = app_current_org_id() AND app_is_member(organization_id));
--> statement-breakpoint
-- A row can only join a plan created in the same transaction (now() is the transaction's start): plans do not change after.
CREATE POLICY maintenance_plan_coverage_insert ON maintenance_plan_coverage FOR INSERT TO climvia_app
  WITH CHECK (
    organization_id = app_current_org_id() AND app_has_role(organization_id, ARRAY['owner', 'admin'])
    AND EXISTS (SELECT 1 FROM maintenance_plans p WHERE p.organization_id = maintenance_plan_coverage.organization_id AND p.id = maintenance_plan_coverage.plan_id AND p.created_at = now())
  );
--> statement-breakpoint

CREATE POLICY maintenance_plan_visits_select ON maintenance_plan_visits FOR SELECT TO climvia_app
  USING (organization_id = app_current_org_id() AND app_is_member(organization_id));
--> statement-breakpoint
-- A new visit is always still to book: no booking, not completed.
CREATE POLICY maintenance_plan_visits_insert ON maintenance_plan_visits FOR INSERT TO climvia_app
  WITH CHECK (
    organization_id = app_current_org_id() AND app_has_role(organization_id, ARRAY['owner', 'admin'])
    AND status = 'due' AND booking_id IS NULL AND completed_on IS NULL
    AND EXISTS (SELECT 1 FROM maintenance_plans p WHERE p.organization_id = maintenance_plan_visits.organization_id AND p.id = maintenance_plan_visits.plan_id AND p.created_at = now())
  );
--> statement-breakpoint
CREATE POLICY maintenance_plan_visits_update ON maintenance_plan_visits FOR UPDATE TO climvia_app
  USING (organization_id = app_current_org_id() AND app_has_role(organization_id, ARRAY['owner', 'admin']))
  WITH CHECK (organization_id = app_current_org_id() AND app_has_role(organization_id, ARRAY['owner', 'admin']));
--> statement-breakpoint

CREATE POLICY reviews_select ON reviews FOR SELECT TO climvia_app
  USING (organization_id = app_current_org_id() AND app_is_member(organization_id));
--> statement-breakpoint

CREATE POLICY review_replies_select ON review_replies FOR SELECT TO climvia_app
  USING (organization_id = app_current_org_id() AND app_is_member(organization_id));
--> statement-breakpoint
CREATE POLICY review_replies_insert ON review_replies FOR INSERT TO climvia_app
  WITH CHECK (organization_id = app_current_org_id() AND app_has_role(organization_id, ARRAY['owner', 'admin']) AND NOT imported);
--> statement-breakpoint
CREATE POLICY review_replies_update ON review_replies FOR UPDATE TO climvia_app
  USING (organization_id = app_current_org_id() AND app_has_role(organization_id, ARRAY['owner', 'admin']))
  WITH CHECK (organization_id = app_current_org_id() AND app_has_role(organization_id, ARRAY['owner', 'admin']));
--> statement-breakpoint

CREATE POLICY review_requests_select ON review_requests FOR SELECT TO climvia_app
  USING (organization_id = app_current_org_id() AND app_is_member(organization_id));
--> statement-breakpoint
CREATE POLICY review_requests_insert ON review_requests FOR INSERT TO climvia_app
  WITH CHECK (organization_id = app_current_org_id() AND app_has_role(organization_id, ARRAY['owner', 'admin']) AND status = 'recorded');
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------------------------
-- 2. Grants: least privilege for the runtime role. Ids, numbers, organization_id, the parties and the words a customer wrote are never rewritten.
-- ---------------------------------------------------------------------------------------------------------------

-- INSERT is table-wide because Drizzle names every column in an INSERT (unset ones as DEFAULT); UPDATE is per column.
-- Plans, coverage, reviews and requests have no UPDATE at all, and nothing here has DELETE. Reviews have no INSERT either.
GRANT SELECT, INSERT ON maintenance_plans, maintenance_plan_coverage, maintenance_plan_visits, review_replies, review_requests TO climvia_app;
--> statement-breakpoint
GRANT SELECT ON reviews TO climvia_app;
--> statement-breakpoint
-- A visit is scheduled, reopened or completed: nothing else about it changes.
GRANT UPDATE (status, booking_id, completed_on) ON maintenance_plan_visits TO climvia_app;
--> statement-breakpoint
-- A reply's text is edited: who replied and when never change.
GRANT UPDATE (body) ON review_replies TO climvia_app;
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------------------------
-- 3. Integrity the constraints cannot express
-- ---------------------------------------------------------------------------------------------------------------

-- due -> scheduled (a booking is attached) -> completed, or back to due when the booking is cancelled. Completed is final. The
-- booking of a visit changes only when a due visit becomes scheduled, and it must be for the plan's own customer.
CREATE FUNCTION plan_visits_guard_update() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status = 'completed' THEN
    RAISE EXCEPTION 'A completed visit is final and cannot be changed'
      USING ERRCODE = '23514', CONSTRAINT = 'plan_visits_final';
  END IF;
  IF OLD.status = 'due' AND NEW.status = 'completed' THEN
    RAISE EXCEPTION 'Only a scheduled visit can be completed'
      USING ERRCODE = '23514', CONSTRAINT = 'plan_visits_status_transition';
  END IF;
  IF NEW.booking_id IS DISTINCT FROM OLD.booking_id THEN
    IF NOT (OLD.status = 'due' AND NEW.status = 'scheduled') THEN
      RAISE EXCEPTION 'A visit''s booking changes only when the visit is scheduled'
        USING ERRCODE = '23514', CONSTRAINT = 'plan_visits_status_transition';
    END IF;
    IF NOT EXISTS (
      SELECT 1
        FROM public.maintenance_plans p
        JOIN public.bookings b ON b.organization_id = p.organization_id
       WHERE p.organization_id = NEW.organization_id AND p.id = NEW.plan_id AND b.id = NEW.booking_id
         AND p.customer_id IS NOT DISTINCT FROM b.customer_id
    ) THEN
      RAISE EXCEPTION 'A visit can only be scheduled with a booking for the plan''s own customer'
        USING ERRCODE = '23514', CONSTRAINT = 'plan_visits_booking_party';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER plan_visits_guard_update BEFORE UPDATE ON maintenance_plan_visits FOR EACH ROW EXECUTE FUNCTION plan_visits_guard_update();
--> statement-breakpoint

-- The visit follows its booking: cancelling the booking reopens the visit (the booking stays pointed at, as history), and
-- completing it completes the visit on the day of the service. Runs as the caller, so the visit's own policy applies.
CREATE FUNCTION bookings_sync_plan_visit() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled' THEN
    UPDATE public.maintenance_plan_visits SET status = 'due'
     WHERE organization_id = NEW.organization_id AND booking_id = NEW.id AND status = 'scheduled';
  ELSIF NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed' THEN
    UPDATE public.maintenance_plan_visits SET status = 'completed', completed_on = NEW.service_date
     WHERE organization_id = NEW.organization_id AND booking_id = NEW.id AND status = 'scheduled';
  END IF;
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE TRIGGER bookings_sync_plan_visit AFTER UPDATE OF status ON bookings FOR EACH ROW EXECUTE FUNCTION bookings_sync_plan_visit();
--> statement-breakpoint

-- Setting the text of a reply again marks it edited, whoever says so.
CREATE FUNCTION review_replies_mark_edited() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.body IS DISTINCT FROM OLD.body THEN
    NEW.edited_at := now();
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER review_replies_mark_edited BEFORE UPDATE ON review_replies FOR EACH ROW EXECUTE FUNCTION review_replies_mark_edited();
--> statement-breakpoint

-- A review is requested for work that is done: the job a request names is completed. (Runs as the caller; Row Level Security
-- applies to what it reads.)
CREATE FUNCTION review_requests_guard_insert() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.job_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.jobs j WHERE j.organization_id = NEW.organization_id AND j.id = NEW.job_id AND j.status = 'completed'
  ) THEN
    RAISE EXCEPTION 'A review can only be requested for a completed job'
      USING ERRCODE = '23514', CONSTRAINT = 'review_requests_job_completed';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER review_requests_guard_insert BEFORE INSERT ON review_requests FOR EACH ROW EXECUTE FUNCTION review_requests_guard_insert();
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------------------------
-- 4. updated_at maintenance (set_updated_at is defined in 0001)
-- ---------------------------------------------------------------------------------------------------------------

CREATE TRIGGER maintenance_plans_set_updated_at BEFORE UPDATE ON maintenance_plans FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER maintenance_plan_coverage_set_updated_at BEFORE UPDATE ON maintenance_plan_coverage FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER maintenance_plan_visits_set_updated_at BEFORE UPDATE ON maintenance_plan_visits FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER reviews_set_updated_at BEFORE UPDATE ON reviews FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER review_replies_set_updated_at BEFORE UPDATE ON review_replies FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER review_requests_set_updated_at BEFORE UPDATE ON review_requests FOR EACH ROW EXECUTE FUNCTION set_updated_at();

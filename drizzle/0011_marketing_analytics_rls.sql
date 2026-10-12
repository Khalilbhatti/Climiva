-- Tenant isolation, grants and integrity for Marketing campaigns and the Analytics imported baseline.
--
-- Hand-written, like 0001, 0003, 0005, 0007 and 0009, and built from the SAME pieces: the transaction-local context (app.user_id /
-- app.org_id) and the SECURITY DEFINER membership checks defined in 0001. Nothing here is a second isolation pattern.
--
-- The rules, per table
--   marketing_campaigns
--       Members of the ACTIVE organization read them. Owners and admins create them, always as a plain Draft (no schedule, no sent
--       day, no delivery result: those are earned by a transition), and change a campaign's content and status through the UPDATE
--       columns granted below. A SENT campaign is final: nothing about it can be updated, by anyone, through any column. Delivery
--       results (delivered / not delivered counts) have no UPDATE privilege at all; only the seed writes them. Nobody deletes.
--   marketing_campaign_selected_customers
--       Members read. Owners and admins add or remove the customers a campaign chose one by one, while the campaign is not sent.
--   marketing_campaign_recipients
--       Members read. Owners and admins add the recipient SNAPSHOT of a Scheduled or Sent campaign ONLY in the transaction that
--       schedules or sends it, and remove it only while the campaign is still Scheduled (a reschedule, a cancel or a send replaces
--       it). Rows are never updated: a snapshot is a record, and a later edit of a Customer never rewrites it.
--   analytics_imported_baselines
--       Members read the rows of the ACTIVE organization. Nobody writes through the application: no INSERT, UPDATE or DELETE
--       privilege and no write policy. The seed (the owner role) is the only author.
--
-- Cross-organization references are impossible rather than merely checked: every child reaches its parent through a composite
-- (organization_id, id) foreign key (see 0010), and PostgreSQL's referential checks run outside Row Level Security.

-- ---------------------------------------------------------------------------------------------------------------
-- 1. Row Level Security policies (RLS is already ENABLED on each table by 0010)
-- ---------------------------------------------------------------------------------------------------------------

CREATE POLICY marketing_campaigns_select ON marketing_campaigns FOR SELECT TO climvia_app
  USING (organization_id = app_current_org_id() AND app_is_member(organization_id));
--> statement-breakpoint
-- A new campaign is a plain Draft: nothing that a transition earns can be written on the way in.
CREATE POLICY marketing_campaigns_insert ON marketing_campaigns FOR INSERT TO climvia_app
  WITH CHECK (
    organization_id = app_current_org_id() AND app_has_role(organization_id, ARRAY['owner', 'admin'])
    AND status = 'draft' AND scheduled_for IS NULL AND sent_at IS NULL AND sent_on IS NULL AND cancelled_at IS NULL
    AND delivered_count IS NULL AND not_delivered_count IS NULL
  );
--> statement-breakpoint
CREATE POLICY marketing_campaigns_update ON marketing_campaigns FOR UPDATE TO climvia_app
  USING (organization_id = app_current_org_id() AND app_has_role(organization_id, ARRAY['owner', 'admin']))
  WITH CHECK (
    organization_id = app_current_org_id() AND app_has_role(organization_id, ARRAY['owner', 'admin'])
    AND delivered_count IS NULL AND not_delivered_count IS NULL
  );
--> statement-breakpoint

CREATE POLICY marketing_campaign_selected_customers_select ON marketing_campaign_selected_customers FOR SELECT TO climvia_app
  USING (organization_id = app_current_org_id() AND app_is_member(organization_id));
--> statement-breakpoint
CREATE POLICY marketing_campaign_selected_customers_insert ON marketing_campaign_selected_customers FOR INSERT TO climvia_app
  WITH CHECK (
    organization_id = app_current_org_id() AND app_has_role(organization_id, ARRAY['owner', 'admin'])
    AND EXISTS (
      SELECT 1 FROM marketing_campaigns c
       WHERE c.organization_id = marketing_campaign_selected_customers.organization_id
         AND c.id = marketing_campaign_selected_customers.campaign_id AND c.status <> 'sent'
    )
  );
--> statement-breakpoint
CREATE POLICY marketing_campaign_selected_customers_delete ON marketing_campaign_selected_customers FOR DELETE TO climvia_app
  USING (
    organization_id = app_current_org_id() AND app_has_role(organization_id, ARRAY['owner', 'admin'])
    AND EXISTS (
      SELECT 1 FROM marketing_campaigns c
       WHERE c.organization_id = marketing_campaign_selected_customers.organization_id
         AND c.id = marketing_campaign_selected_customers.campaign_id AND c.status <> 'sent'
    )
  );
--> statement-breakpoint

CREATE POLICY marketing_campaign_recipients_select ON marketing_campaign_recipients FOR SELECT TO climvia_app
  USING (organization_id = app_current_org_id() AND app_is_member(organization_id));
--> statement-breakpoint
-- A snapshot row can only join a campaign that is Scheduled or Sent AND was changed in this same transaction (updated_at is the
-- transaction's now()): the transition that schedules or sends a campaign is the only moment its recipients are written. A sent
-- campaign cannot be updated again (see the guard below), so no later transaction can ever satisfy this for it. A new row records
-- no delivery result: results are the seed's.
CREATE POLICY marketing_campaign_recipients_insert ON marketing_campaign_recipients FOR INSERT TO climvia_app
  WITH CHECK (
    organization_id = app_current_org_id() AND app_has_role(organization_id, ARRAY['owner', 'admin'])
    AND status = 'pending' AND delivered_at IS NULL AND failure_reason IS NULL
    AND EXISTS (
      SELECT 1 FROM marketing_campaigns c
       WHERE c.organization_id = marketing_campaign_recipients.organization_id
         AND c.id = marketing_campaign_recipients.campaign_id
         AND c.status IN ('scheduled', 'sent') AND c.updated_at = now()
    )
  );
--> statement-breakpoint
-- A pending snapshot is replaced (rescheduled, cancelled, sent): only while the campaign is still Scheduled. A sent campaign's
-- recipients are a permanent record.
CREATE POLICY marketing_campaign_recipients_delete ON marketing_campaign_recipients FOR DELETE TO climvia_app
  USING (
    organization_id = app_current_org_id() AND app_has_role(organization_id, ARRAY['owner', 'admin'])
    AND EXISTS (
      SELECT 1 FROM marketing_campaigns c
       WHERE c.organization_id = marketing_campaign_recipients.organization_id
         AND c.id = marketing_campaign_recipients.campaign_id AND c.status = 'scheduled'
    )
  );
--> statement-breakpoint

CREATE POLICY analytics_imported_baselines_select ON analytics_imported_baselines FOR SELECT TO climvia_app
  USING (organization_id = app_current_org_id() AND app_is_member(organization_id));
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------------------------
-- 2. Grants: least privilege for the runtime role. Ids, references, the creator, the order and the delivery result are never rewritten.
-- ---------------------------------------------------------------------------------------------------------------

-- INSERT is table-wide because Drizzle names every column in an INSERT (unset ones as DEFAULT); UPDATE is per column.
GRANT SELECT, INSERT ON marketing_campaigns, marketing_campaign_selected_customers, marketing_campaign_recipients TO climvia_app;
--> statement-breakpoint
-- A campaign's content and its way through Draft -> Scheduled -> Sent. NOT granted: id, organization_id, slug, created_by,
-- position, created_at, and delivered_count / not_delivered_count (the recorded delivery result).
GRANT UPDATE (name, summary, channel, audience_id, subject, message, status, scheduled_for, sent_at, sent_on, cancelled_at, recipient_count) ON marketing_campaigns TO climvia_app;
--> statement-breakpoint
-- Snapshot rows and chosen customers are replaced, never edited (no UPDATE); the policies above say when.
GRANT DELETE ON marketing_campaign_selected_customers, marketing_campaign_recipients TO climvia_app;
--> statement-breakpoint
-- The baseline is read only.
GRANT SELECT ON analytics_imported_baselines TO climvia_app;
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------------------------
-- 3. Integrity the constraints cannot express
-- ---------------------------------------------------------------------------------------------------------------

-- A Sent campaign is final. Cancelling a schedule (Scheduled -> Draft) is the only thing that stamps cancelled_at, and it always
-- does; a Draft carries no recipient snapshot (its audience is a configuration, resolved again when it is scheduled or sent).
CREATE FUNCTION marketing_campaigns_guard_update() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status = 'sent' THEN
    RAISE EXCEPTION 'A sent campaign is final and cannot be changed'
      USING ERRCODE = '23514', CONSTRAINT = 'campaigns_final';
  END IF;
  IF OLD.status = 'scheduled' AND NEW.status = 'draft' THEN
    IF NEW.cancelled_at IS NOT DISTINCT FROM OLD.cancelled_at THEN
      NEW.cancelled_at := now();
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.marketing_campaign_recipients r WHERE r.organization_id = NEW.organization_id AND r.campaign_id = NEW.id
    ) THEN
      RAISE EXCEPTION 'A draft carries no recipient snapshot: remove it when the schedule is cancelled'
        USING ERRCODE = '23514', CONSTRAINT = 'campaigns_draft_snapshot';
    END IF;
  ELSIF NEW.cancelled_at IS DISTINCT FROM OLD.cancelled_at THEN
    RAISE EXCEPTION 'cancelled_at is stamped only when a schedule is cancelled'
      USING ERRCODE = '23514', CONSTRAINT = 'campaigns_cancelled_at';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER marketing_campaigns_guard_update BEFORE UPDATE ON marketing_campaigns FOR EACH ROW EXECUTE FUNCTION marketing_campaigns_guard_update();
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------------------------
-- 4. updated_at maintenance (set_updated_at is defined in 0001)
-- ---------------------------------------------------------------------------------------------------------------

CREATE TRIGGER marketing_campaigns_set_updated_at BEFORE UPDATE ON marketing_campaigns FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER analytics_imported_baselines_set_updated_at BEFORE UPDATE ON analytics_imported_baselines FOR EACH ROW EXECUTE FUNCTION set_updated_at();

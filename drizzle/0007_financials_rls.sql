-- Tenant isolation, grants and integrity for the business financials: quotes, invoices, payments and their lines.
--
-- Hand-written, like 0001, 0003 and 0005, and built from the SAME pieces: the transaction-local context (app.user_id /
-- app.org_id) and the SECURITY DEFINER membership checks defined in 0001. Nothing here is a second isolation pattern.
--
-- The rules, per table
--   quotes
--       Members of the ACTIVE organization read them. Owners and admins create them (always as drafts) and move them forward
--       (draft -> sent -> approved | declined | expired). Nothing about a quote is rewritten but its status and the date that step
--       happened on. Nobody deletes.
--   quote_line_items, invoice_line_items
--       Members read. Owners and admins add lines ONLY in the transaction that created the document, so a quote or an invoice
--       can never gain or lose a line later (its total is the sum of its lines). Lines are never updated or deleted.
--   invoices
--       Members read. Owners and admins create them, never as imported and never with money "previously paid" (only the seed
--       carries those). An invoice is never updated: it has no status, paid amount or balance of its own, they are derived from
--       its payments. Nobody deletes.
--   payments
--       Members read. Owners and admins record them (as "recorded") and void them. A payment's invoice, customer, amount and
--       date are never rewritten; a mistake is corrected by VOIDING, which is final. Nobody deletes.
--
-- Cross-organization references are impossible rather than merely checked: every child reaches its parent through a composite
-- (organization_id, id) foreign key (see 0006), and PostgreSQL's referential checks run outside Row Level Security.

-- ---------------------------------------------------------------------------------------------------------------
-- 1. Row Level Security policies (RLS is already ENABLED on each table by 0006)
-- ---------------------------------------------------------------------------------------------------------------

CREATE POLICY quotes_select ON quotes FOR SELECT TO climvia_app
  USING (organization_id = app_current_org_id() AND app_is_member(organization_id));
--> statement-breakpoint
CREATE POLICY quotes_insert ON quotes FOR INSERT TO climvia_app
  WITH CHECK (organization_id = app_current_org_id() AND app_has_role(organization_id, ARRAY['owner', 'admin']) AND status = 'draft');
--> statement-breakpoint
CREATE POLICY quotes_update ON quotes FOR UPDATE TO climvia_app
  USING (organization_id = app_current_org_id() AND app_has_role(organization_id, ARRAY['owner', 'admin']))
  WITH CHECK (organization_id = app_current_org_id() AND app_has_role(organization_id, ARRAY['owner', 'admin']));
--> statement-breakpoint

CREATE POLICY quote_line_items_select ON quote_line_items FOR SELECT TO climvia_app
  USING (organization_id = app_current_org_id() AND app_is_member(organization_id));
--> statement-breakpoint
-- A line can only join a quote created in the same transaction (now() is the transaction's start): quotes do not change after.
CREATE POLICY quote_line_items_insert ON quote_line_items FOR INSERT TO climvia_app
  WITH CHECK (
    organization_id = app_current_org_id() AND app_has_role(organization_id, ARRAY['owner', 'admin'])
    AND EXISTS (SELECT 1 FROM quotes q WHERE q.organization_id = quote_line_items.organization_id AND q.id = quote_line_items.quote_id AND q.created_at = now())
  );
--> statement-breakpoint

CREATE POLICY invoices_select ON invoices FOR SELECT TO climvia_app
  USING (organization_id = app_current_org_id() AND app_is_member(organization_id));
--> statement-breakpoint
CREATE POLICY invoices_insert ON invoices FOR INSERT TO climvia_app
  WITH CHECK (
    organization_id = app_current_org_id() AND app_has_role(organization_id, ARRAY['owner', 'admin'])
    AND NOT imported AND previously_paid_cents = 0
  );
--> statement-breakpoint

CREATE POLICY invoice_line_items_select ON invoice_line_items FOR SELECT TO climvia_app
  USING (organization_id = app_current_org_id() AND app_is_member(organization_id));
--> statement-breakpoint
CREATE POLICY invoice_line_items_insert ON invoice_line_items FOR INSERT TO climvia_app
  WITH CHECK (
    organization_id = app_current_org_id() AND app_has_role(organization_id, ARRAY['owner', 'admin'])
    AND EXISTS (SELECT 1 FROM invoices i WHERE i.organization_id = invoice_line_items.organization_id AND i.id = invoice_line_items.invoice_id AND i.created_at = now())
  );
--> statement-breakpoint

CREATE POLICY payments_select ON payments FOR SELECT TO climvia_app
  USING (organization_id = app_current_org_id() AND app_is_member(organization_id));
--> statement-breakpoint
CREATE POLICY payments_insert ON payments FOR INSERT TO climvia_app
  WITH CHECK (organization_id = app_current_org_id() AND app_has_role(organization_id, ARRAY['owner', 'admin']) AND status = 'recorded');
--> statement-breakpoint
CREATE POLICY payments_update ON payments FOR UPDATE TO climvia_app
  USING (organization_id = app_current_org_id() AND app_has_role(organization_id, ARRAY['owner', 'admin']))
  WITH CHECK (organization_id = app_current_org_id() AND app_has_role(organization_id, ARRAY['owner', 'admin']));
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------------------------
-- 2. Grants: least privilege for the runtime role. Ids, numbers, organization_id, the parties, amounts and dates are never rewritten.
-- ---------------------------------------------------------------------------------------------------------------

-- INSERT is table-wide because Drizzle names every column in an INSERT (unset ones as DEFAULT); UPDATE is per column.
-- The line tables and invoices have no UPDATE at all, and nothing here has DELETE.
GRANT SELECT, INSERT ON quotes, quote_line_items, invoices, invoice_line_items, payments TO climvia_app;
--> statement-breakpoint
-- A quote moves through its life: its status and the date that step happened on.
GRANT UPDATE (status, sent_on, approved_on, declined_on, expired_on) ON quotes TO climvia_app;
--> statement-breakpoint
-- A payment is voided: nothing else about it changes.
GRANT UPDATE (status, voided_at, void_reason, void_note, voided_by) ON payments TO climvia_app;
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------------------------
-- 3. Integrity the constraints cannot express
-- ---------------------------------------------------------------------------------------------------------------

-- draft -> sent -> approved | declined | expired. Approved, declined and expired are final.
CREATE FUNCTION quotes_guard_transition() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status IN ('approved', 'declined', 'expired') THEN
    RAISE EXCEPTION 'A % quote is final and cannot be changed', OLD.status
      USING ERRCODE = '23514', CONSTRAINT = 'quotes_final';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
       (OLD.status = 'draft' AND NEW.status = 'sent')
    OR (OLD.status = 'sent' AND NEW.status IN ('approved', 'declined', 'expired'))
  ) THEN
    RAISE EXCEPTION 'A % quote cannot become %', OLD.status, NEW.status
      USING ERRCODE = '23514', CONSTRAINT = 'quotes_status_transition';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER quotes_guard_transition BEFORE UPDATE ON quotes FOR EACH ROW EXECUTE FUNCTION quotes_guard_transition();
--> statement-breakpoint

-- A payment is recorded against an invoice that can take it. The invoice is serialized first (an advisory lock on its id, the
-- same one the application takes), so two payments made at once cannot both spend the same balance: the second waits, then
-- sees the first. The customer is the invoice's, never what the caller says. Runs as the caller: Row Level Security applies to
-- what it reads, and the caller is an owner or admin of the same organization.
CREATE FUNCTION payments_guard_insert() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  carried integer;
  invoice_customer uuid;
  total bigint;
  received bigint;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('invoice-payments:' || NEW.invoice_id::text, 0));
  SELECT i.previously_paid_cents, i.customer_id INTO carried, invoice_customer
    FROM public.invoices i WHERE i.organization_id = NEW.organization_id AND i.id = NEW.invoice_id;
  IF NOT FOUND THEN
    RETURN NEW; -- the foreign key reports a missing invoice
  END IF;
  NEW.customer_id := invoice_customer;
  IF NEW.status = 'recorded' THEN
    SELECT coalesce(sum(l.line_total_cents), 0) INTO total
      FROM public.invoice_line_items l WHERE l.organization_id = NEW.organization_id AND l.invoice_id = NEW.invoice_id;
    SELECT coalesce(sum(p.amount_cents), 0) INTO received
      FROM public.payments p WHERE p.organization_id = NEW.organization_id AND p.invoice_id = NEW.invoice_id AND p.status = 'recorded';
    IF NEW.amount_cents > total - carried - received THEN
      RAISE EXCEPTION 'A payment cannot be more than the invoice balance'
        USING ERRCODE = '23514', CONSTRAINT = 'payments_overpayment';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER payments_guard_insert BEFORE INSERT ON payments FOR EACH ROW EXECUTE FUNCTION payments_guard_insert();
--> statement-breakpoint

-- A recorded payment can be voided, once. A voided payment is final.
CREATE FUNCTION payments_guard_update() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status = 'voided' THEN
    RAISE EXCEPTION 'A voided payment is final and cannot be changed'
      USING ERRCODE = '23514', CONSTRAINT = 'payments_final';
  END IF;
  IF NEW.status <> 'voided' THEN
    RAISE EXCEPTION 'A recorded payment can only be voided'
      USING ERRCODE = '23514', CONSTRAINT = 'payments_status_transition';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER payments_guard_update BEFORE UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION payments_guard_update();
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------------------------
-- 4. updated_at maintenance (set_updated_at is defined in 0001)
-- ---------------------------------------------------------------------------------------------------------------

CREATE TRIGGER quotes_set_updated_at BEFORE UPDATE ON quotes FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER quote_line_items_set_updated_at BEFORE UPDATE ON quote_line_items FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER invoices_set_updated_at BEFORE UPDATE ON invoices FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER invoice_line_items_set_updated_at BEFORE UPDATE ON invoice_line_items FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER payments_set_updated_at BEFORE UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION set_updated_at();

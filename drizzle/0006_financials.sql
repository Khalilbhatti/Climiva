CREATE TABLE "invoice_line_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"sort_order" integer NOT NULL,
	"description" text NOT NULL,
	"detail" text,
	"quantity" numeric(10, 2) NOT NULL,
	"unit" text,
	"unit_price_cents" integer NOT NULL,
	"line_total_cents" integer NOT NULL,
	"service_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoice_lines_order_unique" UNIQUE("invoice_id","sort_order"),
	CONSTRAINT "invoice_lines_quantity" CHECK ("invoice_line_items"."quantity" > 0),
	CONSTRAINT "invoice_lines_price" CHECK ("invoice_line_items"."unit_price_cents" >= 0),
	CONSTRAINT "invoice_lines_total" CHECK ("invoice_line_items"."line_total_cents" = round("invoice_line_items"."quantity" * "invoice_line_items"."unit_price_cents"))
);
--> statement-breakpoint
ALTER TABLE "invoice_line_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"customer_id" uuid,
	"contact_name" text,
	"property_id" uuid,
	"service_id" uuid,
	"job_id" uuid,
	"booking_id" uuid,
	"quote_id" uuid,
	"issue_date" date NOT NULL,
	"payment_terms" text NOT NULL,
	"due_date" date GENERATED ALWAYS AS (issue_date + (case payment_terms when 'net-7' then 7 when 'net-15' then 15 when 'net-30' then 30 else 0 end)) STORED,
	"message" text,
	"imported" boolean DEFAULT false NOT NULL,
	"previously_paid_cents" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "invoices_org_id_customer_unique" UNIQUE("organization_id","id","customer_id"),
	CONSTRAINT "invoices_org_number_unique" UNIQUE("organization_id","number"),
	CONSTRAINT "invoices_org_quote_unique" UNIQUE("organization_id","quote_id"),
	CONSTRAINT "invoices_number_positive" CHECK ("invoices"."number" >= 1),
	CONSTRAINT "invoices_terms" CHECK ("invoices"."payment_terms" in ('due-on-receipt', 'net-7', 'net-15', 'net-30')),
	CONSTRAINT "invoices_party" CHECK (("invoices"."customer_id" is null) = ("invoices"."contact_name" is not null)),
	CONSTRAINT "invoices_property_needs_customer" CHECK ("invoices"."property_id" is null or "invoices"."customer_id" is not null),
	CONSTRAINT "invoices_previously_paid" CHECK ("invoices"."previously_paid_cents" >= 0 and ("invoices"."previously_paid_cents" = 0 or "invoices"."imported"))
);
--> statement-breakpoint
ALTER TABLE "invoices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"invoice_id" uuid NOT NULL,
	"customer_id" uuid,
	"amount_cents" integer NOT NULL,
	"method" text NOT NULL,
	"status" text NOT NULL,
	"paid_on" date NOT NULL,
	"check_number" text,
	"note" text,
	"recorded_by" uuid,
	"recorded_at" timestamp with time zone NOT NULL,
	"voided_at" timestamp with time zone,
	"void_reason" text,
	"void_note" text,
	"voided_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "payments_org_number_unique" UNIQUE("organization_id","number"),
	CONSTRAINT "payments_number_positive" CHECK ("payments"."number" >= 1),
	CONSTRAINT "payments_amount" CHECK ("payments"."amount_cents" > 0),
	CONSTRAINT "payments_method" CHECK ("payments"."method" in ('check', 'card', 'cash', 'bank-transfer', 'other')),
	CONSTRAINT "payments_status" CHECK ("payments"."status" in ('recorded', 'voided')),
	CONSTRAINT "payments_void" CHECK (("payments"."status" = 'voided' and "payments"."voided_at" is not null and "payments"."void_reason" is not null)
        or ("payments"."status" = 'recorded' and "payments"."voided_at" is null and "payments"."void_reason" is null and "payments"."void_note" is null and "payments"."voided_by" is null))
);
--> statement-breakpoint
ALTER TABLE "payments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "quote_line_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"quote_id" uuid NOT NULL,
	"sort_order" integer NOT NULL,
	"description" text NOT NULL,
	"detail" text,
	"quantity" numeric(10, 2) NOT NULL,
	"unit" text,
	"unit_price_cents" integer NOT NULL,
	"line_total_cents" integer NOT NULL,
	"service_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quote_lines_order_unique" UNIQUE("quote_id","sort_order"),
	CONSTRAINT "quote_lines_quantity" CHECK ("quote_line_items"."quantity" > 0),
	CONSTRAINT "quote_lines_price" CHECK ("quote_line_items"."unit_price_cents" >= 0),
	CONSTRAINT "quote_lines_total" CHECK ("quote_line_items"."line_total_cents" = round("quote_line_items"."quantity" * "quote_line_items"."unit_price_cents"))
);
--> statement-breakpoint
ALTER TABLE "quote_line_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "quotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"customer_id" uuid,
	"contact_name" text,
	"property_id" uuid,
	"service_id" uuid,
	"job_id" uuid,
	"booking_id" uuid,
	"status" text NOT NULL,
	"created_on" date NOT NULL,
	"sent_on" date,
	"approved_on" date,
	"declined_on" date,
	"expired_on" date,
	"valid_through" date,
	"message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quotes_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "quotes_org_number_unique" UNIQUE("organization_id","number"),
	CONSTRAINT "quotes_number_positive" CHECK ("quotes"."number" >= 1),
	CONSTRAINT "quotes_status" CHECK ("quotes"."status" in ('draft', 'sent', 'approved', 'declined', 'expired')),
	CONSTRAINT "quotes_party" CHECK (("quotes"."customer_id" is null) = ("quotes"."contact_name" is not null)),
	CONSTRAINT "quotes_property_needs_customer" CHECK ("quotes"."property_id" is null or "quotes"."customer_id" is not null),
	CONSTRAINT "quotes_status_dates" CHECK (("quotes"."status" <> 'sent' or "quotes"."sent_on" is not null)
        and ("quotes"."status" <> 'approved' or ("quotes"."sent_on" is not null and "quotes"."approved_on" is not null))
        and ("quotes"."status" <> 'declined' or ("quotes"."sent_on" is not null and "quotes"."declined_on" is not null))
        and ("quotes"."status" <> 'expired' or ("quotes"."sent_on" is not null and "quotes"."expired_on" is not null))
        and ("quotes"."status" = 'approved' or "quotes"."approved_on" is null)
        and ("quotes"."status" = 'declined' or "quotes"."declined_on" is null)
        and ("quotes"."status" = 'expired' or "quotes"."expired_on" is null)
        and ("quotes"."status" <> 'draft' or "quotes"."sent_on" is null))
);
--> statement-breakpoint
ALTER TABLE "quotes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "organization_sequences" DROP CONSTRAINT "organization_sequences_kind";--> statement-breakpoint
ALTER TABLE "invoice_line_items" ADD CONSTRAINT "invoice_line_items_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_line_items" ADD CONSTRAINT "invoice_lines_invoice_fk" FOREIGN KEY ("organization_id","invoice_id") REFERENCES "public"."invoices"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_line_items" ADD CONSTRAINT "invoice_lines_service_fk" FOREIGN KEY ("organization_id","service_id") REFERENCES "public"."services"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_customer_fk" FOREIGN KEY ("organization_id","customer_id") REFERENCES "public"."customers"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_property_fk" FOREIGN KEY ("organization_id","customer_id","property_id") REFERENCES "public"."customer_properties"("organization_id","customer_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_service_fk" FOREIGN KEY ("organization_id","service_id") REFERENCES "public"."services"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_job_fk" FOREIGN KEY ("organization_id","job_id") REFERENCES "public"."jobs"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_booking_fk" FOREIGN KEY ("organization_id","booking_id") REFERENCES "public"."bookings"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_quote_fk" FOREIGN KEY ("organization_id","quote_id") REFERENCES "public"."quotes"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoice_fk" FOREIGN KEY ("organization_id","invoice_id") REFERENCES "public"."invoices"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoice_customer_fk" FOREIGN KEY ("organization_id","invoice_id","customer_id") REFERENCES "public"."invoices"("organization_id","id","customer_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_customer_fk" FOREIGN KEY ("organization_id","customer_id") REFERENCES "public"."customers"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_recorded_by_fk" FOREIGN KEY ("organization_id","recorded_by") REFERENCES "public"."team_members"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_voided_by_fk" FOREIGN KEY ("organization_id","voided_by") REFERENCES "public"."team_members"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_line_items" ADD CONSTRAINT "quote_line_items_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_line_items" ADD CONSTRAINT "quote_lines_quote_fk" FOREIGN KEY ("organization_id","quote_id") REFERENCES "public"."quotes"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_line_items" ADD CONSTRAINT "quote_lines_service_fk" FOREIGN KEY ("organization_id","service_id") REFERENCES "public"."services"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_customer_fk" FOREIGN KEY ("organization_id","customer_id") REFERENCES "public"."customers"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_property_fk" FOREIGN KEY ("organization_id","customer_id","property_id") REFERENCES "public"."customer_properties"("organization_id","customer_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_service_fk" FOREIGN KEY ("organization_id","service_id") REFERENCES "public"."services"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_job_fk" FOREIGN KEY ("organization_id","job_id") REFERENCES "public"."jobs"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_booking_fk" FOREIGN KEY ("organization_id","booking_id") REFERENCES "public"."bookings"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invoice_lines_invoice_idx" ON "invoice_line_items" USING btree ("organization_id","invoice_id");--> statement-breakpoint
CREATE INDEX "invoices_org_customer_idx" ON "invoices" USING btree ("organization_id","customer_id");--> statement-breakpoint
CREATE INDEX "invoices_org_job_idx" ON "invoices" USING btree ("organization_id","job_id");--> statement-breakpoint
CREATE INDEX "invoices_org_issue_idx" ON "invoices" USING btree ("organization_id","issue_date");--> statement-breakpoint
CREATE INDEX "invoices_org_due_idx" ON "invoices" USING btree ("organization_id","due_date");--> statement-breakpoint
CREATE INDEX "payments_org_invoice_idx" ON "payments" USING btree ("organization_id","invoice_id");--> statement-breakpoint
CREATE INDEX "payments_org_customer_idx" ON "payments" USING btree ("organization_id","customer_id");--> statement-breakpoint
CREATE INDEX "payments_org_paid_idx" ON "payments" USING btree ("organization_id","paid_on");--> statement-breakpoint
CREATE INDEX "payments_org_status_idx" ON "payments" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "quote_lines_quote_idx" ON "quote_line_items" USING btree ("organization_id","quote_id");--> statement-breakpoint
CREATE INDEX "quotes_org_status_idx" ON "quotes" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "quotes_org_customer_idx" ON "quotes" USING btree ("organization_id","customer_id");--> statement-breakpoint
CREATE INDEX "quotes_org_job_idx" ON "quotes" USING btree ("organization_id","job_id");--> statement-breakpoint
CREATE INDEX "quotes_org_created_idx" ON "quotes" USING btree ("organization_id","created_on");--> statement-breakpoint
ALTER TABLE "organization_sequences" ADD CONSTRAINT "organization_sequences_kind" CHECK ("organization_sequences"."kind" in ('booking', 'job', 'quote', 'invoice', 'payment'));
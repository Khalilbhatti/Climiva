CREATE TABLE "maintenance_plan_coverage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"coverage_key" text NOT NULL,
	"label" text NOT NULL,
	"visits" integer NOT NULL,
	"sort_order" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plan_coverage_org_plan_id_unique" UNIQUE("organization_id","plan_id","id"),
	CONSTRAINT "plan_coverage_key_unique" UNIQUE("plan_id","coverage_key"),
	CONSTRAINT "plan_coverage_order_unique" UNIQUE("plan_id","sort_order"),
	CONSTRAINT "plan_coverage_key" CHECK ("maintenance_plan_coverage"."coverage_key" in ('cooling', 'heating')),
	CONSTRAINT "plan_coverage_label" CHECK (char_length(btrim("maintenance_plan_coverage"."label")) between 1 and 80),
	CONSTRAINT "plan_coverage_visits" CHECK ("maintenance_plan_coverage"."visits" between 1 and 12)
);
--> statement-breakpoint
ALTER TABLE "maintenance_plan_coverage" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "maintenance_plan_visits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"coverage_id" uuid,
	"ref" text NOT NULL,
	"sequence" integer NOT NULL,
	"label" text NOT NULL,
	"window_start" date,
	"window_end" date,
	"status" text NOT NULL,
	"booking_id" uuid,
	"completed_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plan_visits_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "plan_visits_org_ref_unique" UNIQUE("organization_id","ref"),
	CONSTRAINT "plan_visits_order_unique" UNIQUE("plan_id","sequence"),
	CONSTRAINT "plan_visits_org_booking_unique" UNIQUE("organization_id","booking_id"),
	CONSTRAINT "plan_visits_ref" CHECK ("maintenance_plan_visits"."ref" ~ '^[a-z0-9][a-z0-9-]{0,159}$'),
	CONSTRAINT "plan_visits_sequence" CHECK ("maintenance_plan_visits"."sequence" >= 1),
	CONSTRAINT "plan_visits_label" CHECK (char_length(btrim("maintenance_plan_visits"."label")) between 1 and 120),
	CONSTRAINT "plan_visits_status" CHECK ("maintenance_plan_visits"."status" in ('due', 'scheduled', 'completed')),
	CONSTRAINT "plan_visits_window" CHECK (("maintenance_plan_visits"."window_start" is null) = ("maintenance_plan_visits"."window_end" is null) and ("maintenance_plan_visits"."window_start" is null or "maintenance_plan_visits"."window_end" >= "maintenance_plan_visits"."window_start")),
	CONSTRAINT "plan_visits_scheduled" CHECK ("maintenance_plan_visits"."status" <> 'scheduled' or "maintenance_plan_visits"."booking_id" is not null),
	CONSTRAINT "plan_visits_completed" CHECK ("maintenance_plan_visits"."completed_on" is null or "maintenance_plan_visits"."status" = 'completed')
);
--> statement-breakpoint
ALTER TABLE "maintenance_plan_visits" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "maintenance_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"customer_id" uuid,
	"contact_name" text,
	"property_id" uuid,
	"property_text" text,
	"name" text NOT NULL,
	"status" text NOT NULL,
	"status_note" text,
	"price_cents" integer NOT NULL,
	"cadence" text NOT NULL,
	"start_date" date,
	"end_date" date,
	"visits_per_year" integer NOT NULL,
	"note" text,
	"imported" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plans_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "plans_org_slug_unique" UNIQUE("organization_id","slug"),
	CONSTRAINT "plans_slug" CHECK ("maintenance_plans"."slug" ~ '^[a-z0-9][a-z0-9-]{0,119}$'),
	CONSTRAINT "plans_status" CHECK ("maintenance_plans"."status" in ('active', 'pending', 'paused', 'ended')),
	CONSTRAINT "plans_cadence" CHECK ("maintenance_plans"."cadence" in ('year', 'month', 'one-time')),
	CONSTRAINT "plans_name" CHECK (char_length(btrim("maintenance_plans"."name")) between 1 and 120),
	CONSTRAINT "plans_price" CHECK ("maintenance_plans"."price_cents" >= 0),
	CONSTRAINT "plans_visits" CHECK ("maintenance_plans"."visits_per_year" between 0 and 24),
	CONSTRAINT "plans_term" CHECK ("maintenance_plans"."start_date" is null or "maintenance_plans"."end_date" is null or "maintenance_plans"."end_date" > "maintenance_plans"."start_date"),
	CONSTRAINT "plans_party" CHECK (("maintenance_plans"."customer_id" is null) = ("maintenance_plans"."contact_name" is not null)),
	CONSTRAINT "plans_property_needs_customer" CHECK ("maintenance_plans"."property_id" is null or "maintenance_plans"."customer_id" is not null),
	CONSTRAINT "plans_address_snapshot" CHECK ("maintenance_plans"."property_text" is null or "maintenance_plans"."customer_id" is null)
);
--> statement-breakpoint
ALTER TABLE "maintenance_plans" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "review_replies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"review_id" uuid NOT NULL,
	"body" text NOT NULL,
	"author_name" text NOT NULL,
	"replied_by" uuid,
	"replied_at" timestamp with time zone NOT NULL,
	"edited_at" timestamp with time zone,
	"imported" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_replies_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "review_replies_review_unique" UNIQUE("organization_id","review_id"),
	CONSTRAINT "review_replies_body" CHECK (char_length(btrim("review_replies"."body")) between 1 and 500),
	CONSTRAINT "review_replies_author" CHECK (char_length(btrim("review_replies"."author_name")) between 1 and 120)
);
--> statement-breakpoint
ALTER TABLE "review_replies" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "review_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"job_id" uuid,
	"channel" text NOT NULL,
	"message" text NOT NULL,
	"status" text NOT NULL,
	"requested_at" timestamp with time zone NOT NULL,
	"created_by" uuid,
	"position" integer GENERATED ALWAYS AS IDENTITY (sequence name "review_requests_position_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_requests_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "review_requests_channel" CHECK ("review_requests"."channel" in ('email', 'sms')),
	CONSTRAINT "review_requests_message" CHECK (char_length(btrim("review_requests"."message")) between 1 and 500),
	CONSTRAINT "review_requests_status" CHECK ("review_requests"."status" in ('recorded'))
);
--> statement-breakpoint
ALTER TABLE "review_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"customer_id" uuid,
	"contact_name" text,
	"job_id" uuid,
	"source" text NOT NULL,
	"rating" smallint NOT NULL,
	"review_text" text NOT NULL,
	"submitted_on" date NOT NULL,
	"reply_draft" text,
	"imported" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reviews_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "reviews_org_slug_unique" UNIQUE("organization_id","slug"),
	CONSTRAINT "reviews_slug" CHECK ("reviews"."slug" ~ '^[a-z0-9][a-z0-9-]{0,119}$'),
	CONSTRAINT "reviews_source" CHECK ("reviews"."source" in ('Climvia')),
	CONSTRAINT "reviews_rating" CHECK ("reviews"."rating" between 1 and 5),
	CONSTRAINT "reviews_text" CHECK (char_length(btrim("reviews"."review_text")) between 1 and 2000),
	CONSTRAINT "reviews_party" CHECK (("reviews"."customer_id" is null) = ("reviews"."contact_name" is not null))
);
--> statement-breakpoint
ALTER TABLE "reviews" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "bookings" DROP CONSTRAINT "bookings_plan_visit";--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_org_id_customer_unique" UNIQUE("organization_id","id","customer_id");--> statement-breakpoint
ALTER TABLE "maintenance_plan_coverage" ADD CONSTRAINT "maintenance_plan_coverage_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_plan_coverage" ADD CONSTRAINT "plan_coverage_plan_fk" FOREIGN KEY ("organization_id","plan_id") REFERENCES "public"."maintenance_plans"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_plan_visits" ADD CONSTRAINT "maintenance_plan_visits_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_plan_visits" ADD CONSTRAINT "plan_visits_plan_fk" FOREIGN KEY ("organization_id","plan_id") REFERENCES "public"."maintenance_plans"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_plan_visits" ADD CONSTRAINT "plan_visits_coverage_fk" FOREIGN KEY ("organization_id","plan_id","coverage_id") REFERENCES "public"."maintenance_plan_coverage"("organization_id","plan_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_plan_visits" ADD CONSTRAINT "plan_visits_booking_fk" FOREIGN KEY ("organization_id","booking_id") REFERENCES "public"."bookings"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_plans" ADD CONSTRAINT "maintenance_plans_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_plans" ADD CONSTRAINT "plans_customer_fk" FOREIGN KEY ("organization_id","customer_id") REFERENCES "public"."customers"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_plans" ADD CONSTRAINT "plans_property_fk" FOREIGN KEY ("organization_id","customer_id","property_id") REFERENCES "public"."customer_properties"("organization_id","customer_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_replies" ADD CONSTRAINT "review_replies_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_replies" ADD CONSTRAINT "review_replies_review_fk" FOREIGN KEY ("organization_id","review_id") REFERENCES "public"."reviews"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_replies" ADD CONSTRAINT "review_replies_by_fk" FOREIGN KEY ("organization_id","replied_by") REFERENCES "public"."team_members"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_requests" ADD CONSTRAINT "review_requests_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_requests" ADD CONSTRAINT "review_requests_customer_fk" FOREIGN KEY ("organization_id","customer_id") REFERENCES "public"."customers"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_requests" ADD CONSTRAINT "review_requests_job_fk" FOREIGN KEY ("organization_id","job_id") REFERENCES "public"."jobs"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_requests" ADD CONSTRAINT "review_requests_job_customer_fk" FOREIGN KEY ("organization_id","job_id","customer_id") REFERENCES "public"."jobs"("organization_id","id","customer_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_requests" ADD CONSTRAINT "review_requests_by_fk" FOREIGN KEY ("organization_id","created_by") REFERENCES "public"."team_members"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_customer_fk" FOREIGN KEY ("organization_id","customer_id") REFERENCES "public"."customers"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_job_fk" FOREIGN KEY ("organization_id","job_id") REFERENCES "public"."jobs"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_job_customer_fk" FOREIGN KEY ("organization_id","job_id","customer_id") REFERENCES "public"."jobs"("organization_id","id","customer_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "plan_coverage_plan_idx" ON "maintenance_plan_coverage" USING btree ("organization_id","plan_id");--> statement-breakpoint
CREATE INDEX "plan_visits_plan_idx" ON "maintenance_plan_visits" USING btree ("organization_id","plan_id");--> statement-breakpoint
CREATE INDEX "plan_visits_org_status_window_idx" ON "maintenance_plan_visits" USING btree ("organization_id","status","window_start");--> statement-breakpoint
CREATE INDEX "plans_org_status_idx" ON "maintenance_plans" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "plans_org_customer_idx" ON "maintenance_plans" USING btree ("organization_id","customer_id");--> statement-breakpoint
CREATE INDEX "plans_org_property_idx" ON "maintenance_plans" USING btree ("organization_id","property_id");--> statement-breakpoint
CREATE INDEX "plans_org_end_idx" ON "maintenance_plans" USING btree ("organization_id","end_date");--> statement-breakpoint
CREATE UNIQUE INDEX "review_requests_job_active_unique" ON "review_requests" USING btree ("organization_id","job_id") WHERE "review_requests"."job_id" is not null and "review_requests"."status" = 'recorded';--> statement-breakpoint
CREATE INDEX "review_requests_org_customer_idx" ON "review_requests" USING btree ("organization_id","customer_id");--> statement-breakpoint
CREATE INDEX "review_requests_org_job_idx" ON "review_requests" USING btree ("organization_id","job_id","status");--> statement-breakpoint
CREATE INDEX "reviews_org_submitted_idx" ON "reviews" USING btree ("organization_id","submitted_on");--> statement-breakpoint
CREATE INDEX "reviews_org_rating_idx" ON "reviews" USING btree ("organization_id","rating");--> statement-breakpoint
CREATE INDEX "reviews_org_customer_idx" ON "reviews" USING btree ("organization_id","customer_id");--> statement-breakpoint
CREATE INDEX "reviews_org_job_idx" ON "reviews" USING btree ("organization_id","job_id");--> statement-breakpoint
ALTER TABLE "bookings" DROP COLUMN "plan_id";--> statement-breakpoint
ALTER TABLE "bookings" DROP COLUMN "plan_visit_id";

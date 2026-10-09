-- The two unique constraints that the foreign keys below reference come first (drizzle-kit writes them last).
ALTER TABLE "customer_properties" ADD CONSTRAINT "customer_properties_org_customer_id_unique" UNIQUE("organization_id","customer_id","id");--> statement-breakpoint
ALTER TABLE "equipment" ADD CONSTRAINT "equipment_org_id_unique" UNIQUE("organization_id","id");--> statement-breakpoint
CREATE TABLE "bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"customer_id" uuid,
	"property_id" uuid,
	"service_id" uuid NOT NULL,
	"assignee_id" uuid,
	"contact_name" text,
	"contact_phone" text,
	"contact_email" text,
	"contact_address" text,
	"source" text,
	"status" text NOT NULL,
	"service_date" date NOT NULL,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	"note" text,
	"intake_system_type" text,
	"intake_equipment" text,
	"intake_reported_issue" text,
	"internal_notes" text,
	"cancellation_reason" text,
	"plan_id" text,
	"plan_visit_id" text,
	"received_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bookings_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "bookings_org_number_unique" UNIQUE("organization_id","number"),
	CONSTRAINT "bookings_number_positive" CHECK ("bookings"."number" >= 1),
	CONSTRAINT "bookings_source" CHECK ("bookings"."source" in ('Website', 'Booking link', 'Marketplace', 'Maintenance plan', 'Phone / Front desk', 'Email', 'Walk-in', 'Other')),
	CONSTRAINT "bookings_status" CHECK ("bookings"."status" in ('pending', 'confirmed', 'completed', 'cancelled')),
	CONSTRAINT "bookings_time_order" CHECK ("bookings"."end_time" > "bookings"."start_time"),
	CONSTRAINT "bookings_party" CHECK (("bookings"."customer_id" is null) = ("bookings"."contact_name" is not null)),
	CONSTRAINT "bookings_contact_without_customer" CHECK ("bookings"."customer_id" is null or ("bookings"."contact_phone" is null and "bookings"."contact_email" is null and "bookings"."contact_address" is null)),
	CONSTRAINT "bookings_property_needs_customer" CHECK ("bookings"."property_id" is null or "bookings"."customer_id" is not null),
	CONSTRAINT "bookings_cancellation" CHECK (("bookings"."status" = 'cancelled') = ("bookings"."cancellation_reason" is not null)),
	CONSTRAINT "bookings_plan_visit" CHECK (("bookings"."plan_id" is null) = ("bookings"."plan_visit_id" is null))
);
--> statement-breakpoint
ALTER TABLE "bookings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "job_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"position" integer GENERATED ALWAYS AS IDENTITY (sequence name "job_files_position_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"ref" text NOT NULL,
	"name" text NOT NULL,
	"size_kb" integer NOT NULL,
	"category" text,
	"caption" text,
	"taken_at" time,
	"visibility" text NOT NULL,
	"badge" text,
	"storage_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_files_job_ref_unique" UNIQUE("job_id","ref"),
	CONSTRAINT "job_files_category" CHECK ("job_files"."category" is null or "job_files"."category" in ('Before work', 'Diagnostic / Meter', 'Equipment serial', 'After completion')),
	CONSTRAINT "job_files_visibility" CHECK ("job_files"."visibility" in ('customer', 'internal')),
	CONSTRAINT "job_files_size" CHECK ("job_files"."size_kb" >= 0)
);
--> statement-breakpoint
ALTER TABLE "job_files" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"booking_id" uuid,
	"customer_id" uuid,
	"property_id" uuid,
	"service_id" uuid NOT NULL,
	"assignee_id" uuid,
	"equipment_id" uuid,
	"contact_name" text,
	"status" text NOT NULL,
	"service_date" date NOT NULL,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	"work_summary" text,
	"note" text,
	"technician_diagnosis" text,
	"work_performed" text,
	"customer_summary" text,
	"internal_notes" text,
	"customer_request" text,
	"safety_note" text,
	"checklist" jsonb,
	"completion_notes" text,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "jobs_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "jobs_org_number_unique" UNIQUE("organization_id","number"),
	CONSTRAINT "jobs_org_booking_unique" UNIQUE("organization_id","booking_id"),
	CONSTRAINT "jobs_number_positive" CHECK ("jobs"."number" >= 1),
	CONSTRAINT "jobs_status" CHECK ("jobs"."status" in ('scheduled', 'in-progress', 'completed')),
	CONSTRAINT "jobs_time_order" CHECK ("jobs"."end_time" > "jobs"."start_time"),
	CONSTRAINT "jobs_party" CHECK (("jobs"."customer_id" is null) = ("jobs"."contact_name" is not null)),
	CONSTRAINT "jobs_property_needs_customer" CHECK ("jobs"."property_id" is null or "jobs"."customer_id" is not null),
	CONSTRAINT "jobs_completion" CHECK (("jobs"."status" = 'completed' and "jobs"."completed_at" is not null and "jobs"."completion_notes" is not null)
        or ("jobs"."status" <> 'completed' and "jobs"."completed_at" is null and "jobs"."completion_notes" is null)),
	CONSTRAINT "jobs_checklist_shape" CHECK ("jobs"."checklist" is null or jsonb_typeof("jobs"."checklist") = 'array')
);
--> statement-breakpoint
ALTER TABLE "jobs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "organization_sequences" (
	"organization_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"next_value" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_sequences_pk" PRIMARY KEY("organization_id","kind"),
	CONSTRAINT "organization_sequences_kind" CHECK ("organization_sequences"."kind" in ('booking', 'job')),
	CONSTRAINT "organization_sequences_positive" CHECK ("organization_sequences"."next_value" >= 1)
);
--> statement-breakpoint
ALTER TABLE "organization_sequences" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "schedule_block_members" (
	"organization_id" uuid NOT NULL,
	"block_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	CONSTRAINT "schedule_block_members_pk" PRIMARY KEY("block_id","member_id")
);
--> statement-breakpoint
ALTER TABLE "schedule_block_members" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "schedule_blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"position" integer GENERATED ALWAYS AS IDENTITY (sequence name "schedule_blocks_position_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"ref" text NOT NULL,
	"title" text NOT NULL,
	"service_date" date NOT NULL,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "schedule_blocks_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "schedule_blocks_time_order" CHECK ("schedule_blocks"."end_time" > "schedule_blocks"."start_time"),
	CONSTRAINT "schedule_blocks_title" CHECK (char_length(btrim("schedule_blocks"."title")) between 1 and 120)
);
--> statement-breakpoint
ALTER TABLE "schedule_blocks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_customer_fk" FOREIGN KEY ("organization_id","customer_id") REFERENCES "public"."customers"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_property_fk" FOREIGN KEY ("organization_id","customer_id","property_id") REFERENCES "public"."customer_properties"("organization_id","customer_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_service_fk" FOREIGN KEY ("organization_id","service_id") REFERENCES "public"."services"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_assignee_fk" FOREIGN KEY ("organization_id","assignee_id") REFERENCES "public"."team_members"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_files" ADD CONSTRAINT "job_files_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_files" ADD CONSTRAINT "job_files_job_fk" FOREIGN KEY ("organization_id","job_id") REFERENCES "public"."jobs"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_booking_fk" FOREIGN KEY ("organization_id","booking_id") REFERENCES "public"."bookings"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_customer_fk" FOREIGN KEY ("organization_id","customer_id") REFERENCES "public"."customers"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_property_fk" FOREIGN KEY ("organization_id","customer_id","property_id") REFERENCES "public"."customer_properties"("organization_id","customer_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_service_fk" FOREIGN KEY ("organization_id","service_id") REFERENCES "public"."services"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_assignee_fk" FOREIGN KEY ("organization_id","assignee_id") REFERENCES "public"."team_members"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_equipment_fk" FOREIGN KEY ("organization_id","equipment_id") REFERENCES "public"."equipment"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_sequences" ADD CONSTRAINT "organization_sequences_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_block_members" ADD CONSTRAINT "schedule_block_members_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_block_members" ADD CONSTRAINT "schedule_block_members_block_fk" FOREIGN KEY ("organization_id","block_id") REFERENCES "public"."schedule_blocks"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_block_members" ADD CONSTRAINT "schedule_block_members_member_fk" FOREIGN KEY ("organization_id","member_id") REFERENCES "public"."team_members"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_blocks" ADD CONSTRAINT "schedule_blocks_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bookings_org_status_date_idx" ON "bookings" USING btree ("organization_id","status","service_date");--> statement-breakpoint
CREATE INDEX "bookings_org_customer_idx" ON "bookings" USING btree ("organization_id","customer_id");--> statement-breakpoint
CREATE INDEX "bookings_org_service_idx" ON "bookings" USING btree ("organization_id","service_id");--> statement-breakpoint
CREATE INDEX "bookings_org_assignee_idx" ON "bookings" USING btree ("organization_id","assignee_id");--> statement-breakpoint
CREATE INDEX "job_files_job_idx" ON "job_files" USING btree ("organization_id","job_id");--> statement-breakpoint
CREATE INDEX "jobs_org_status_date_idx" ON "jobs" USING btree ("organization_id","status","service_date");--> statement-breakpoint
CREATE INDEX "jobs_org_customer_idx" ON "jobs" USING btree ("organization_id","customer_id");--> statement-breakpoint
CREATE INDEX "jobs_org_service_idx" ON "jobs" USING btree ("organization_id","service_id");--> statement-breakpoint
CREATE INDEX "jobs_org_assignee_idx" ON "jobs" USING btree ("organization_id","assignee_id");--> statement-breakpoint
CREATE INDEX "schedule_block_members_member_idx" ON "schedule_block_members" USING btree ("organization_id","member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "schedule_blocks_org_ref_unique" ON "schedule_blocks" USING btree ("organization_id","ref");--> statement-breakpoint
CREATE INDEX "schedule_blocks_org_date_idx" ON "schedule_blocks" USING btree ("organization_id","service_date","start_time");

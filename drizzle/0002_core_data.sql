CREATE TABLE "customer_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"position" integer GENERATED ALWAYS AS IDENTITY (sequence name "customer_notes_position_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"body" text NOT NULL,
	"updated_on" text NOT NULL,
	"recorded_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_notes_body_length" CHECK (char_length(btrim("customer_notes"."body")) between 1 and 4000),
	CONSTRAINT "customer_notes_updated_on" CHECK ("customer_notes"."updated_on" ~ '^\d{4}-\d{2}-\d{2}$')
);
--> statement-breakpoint
ALTER TABLE "customer_notes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "customer_properties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"position" integer GENERATED ALWAYS AS IDENTITY (sequence name "customer_properties_position_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"slug" text NOT NULL,
	"label" text NOT NULL,
	"address_line1" text NOT NULL,
	"address_line2" text,
	"city" text NOT NULL,
	"state_region" text NOT NULL,
	"postal_code" text NOT NULL,
	"country" text DEFAULT 'US' NOT NULL,
	"area" text,
	"access_instructions" text,
	"mechanical_access" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_properties_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "customer_properties_org_slug_unique" UNIQUE("organization_id","slug"),
	CONSTRAINT "customer_properties_slug_format" CHECK ("customer_properties"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length("customer_properties"."slug") <= 80),
	CONSTRAINT "customer_properties_label_length" CHECK (char_length(btrim("customer_properties"."label")) between 1 and 40),
	CONSTRAINT "customer_properties_address_present" CHECK (char_length(btrim("customer_properties"."address_line1")) > 0 and char_length(btrim("customer_properties"."city")) > 0 and char_length(btrim("customer_properties"."state_region")) > 0 and char_length(btrim("customer_properties"."postal_code")) > 0)
);
--> statement-breakpoint
ALTER TABLE "customer_properties" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"position" integer GENERATED ALWAYS AS IDENTITY (sequence name "customers_position_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"organization_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"type" text DEFAULT 'residential' NOT NULL,
	"phone" text,
	"email" text,
	"preferred_contact" text DEFAULT 'SMS' NOT NULL,
	"language" text,
	"preferences" text[] DEFAULT '{}'::text[] NOT NULL,
	"maintenance_plan" jsonb,
	"last_service" jsonb,
	"upcoming" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customers_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "customers_org_slug_unique" UNIQUE("organization_id","slug"),
	CONSTRAINT "customers_slug_format" CHECK ("customers"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length("customers"."slug") <= 80),
	CONSTRAINT "customers_name_length" CHECK (char_length(btrim("customers"."name")) between 1 and 80),
	CONSTRAINT "customers_type" CHECK ("customers"."type" in ('residential')),
	CONSTRAINT "customers_preferred_contact" CHECK ("customers"."preferred_contact" in ('SMS', 'Phone', 'Email')),
	CONSTRAINT "customers_json_shapes" CHECK (("customers"."maintenance_plan" is null or jsonb_typeof("customers"."maintenance_plan") = 'object') and ("customers"."last_service" is null or jsonb_typeof("customers"."last_service") = 'object') and ("customers"."upcoming" is null or jsonb_typeof("customers"."upcoming") = 'object'))
);
--> statement-breakpoint
ALTER TABLE "customers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "equipment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"position" integer GENERATED ALWAYS AS IDENTITY (sequence name "equipment_position_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"capacity" text,
	"manufacturer" text NOT NULL,
	"model" text NOT NULL,
	"model_code" text NOT NULL,
	"serial_number" text NOT NULL,
	"location" text NOT NULL,
	"in_service_since" text NOT NULL,
	"refrigerant" text,
	"filter" text,
	"status" text DEFAULT 'active' NOT NULL,
	"last_serviced" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "equipment_org_slug_unique" UNIQUE("organization_id","slug"),
	CONSTRAINT "equipment_slug_format" CHECK ("equipment"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length("equipment"."slug") <= 80),
	CONSTRAINT "equipment_name_length" CHECK (char_length(btrim("equipment"."name")) between 1 and 120),
	CONSTRAINT "equipment_in_service_since" CHECK ("equipment"."in_service_since" ~ '^\d{4}-(0[1-9]|1[0-2])$'),
	CONSTRAINT "equipment_status" CHECK ("equipment"."status" in ('active')),
	CONSTRAINT "equipment_last_serviced_shape" CHECK ("equipment"."last_serviced" is null or jsonb_typeof("equipment"."last_serviced") = 'object')
);
--> statement-breakpoint
ALTER TABLE "equipment" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"audience" text[] DEFAULT '{residential}'::text[] NOT NULL,
	"description" text NOT NULL,
	"internal_description" text,
	"duration_minutes" integer NOT NULL,
	"pricing_model" text NOT NULL,
	"price_amount" numeric(10, 2),
	"price_label" text,
	"booking_method" text NOT NULL,
	"visibility" text DEFAULT 'public-booking' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"display_order" integer NOT NULL,
	"intake" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"checklist" text[],
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "services_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "services_org_slug_unique" UNIQUE("organization_id","slug"),
	CONSTRAINT "services_slug_format" CHECK ("services"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length("services"."slug") <= 80),
	CONSTRAINT "services_name_length" CHECK (char_length(btrim("services"."name")) between 1 and 60),
	CONSTRAINT "services_category" CHECK ("services"."category" in ('Cooling', 'Heating', 'Heat pumps', 'Maintenance', 'Emergency')),
	CONSTRAINT "services_audience" CHECK (cardinality("services"."audience") >= 1 and "services"."audience" <@ array['residential', 'commercial']::text[]),
	CONSTRAINT "services_duration" CHECK ("services"."duration_minutes" between 15 and 1440),
	CONSTRAINT "services_pricing_model" CHECK ("services"."pricing_model" in ('diagnostic-fee', 'fixed-price', 'free-assessment')),
	CONSTRAINT "services_pricing_shape" CHECK (("services"."pricing_model" = 'free-assessment' and "services"."price_amount" is null and "services"."price_label" is null)
        or ("services"."pricing_model" = 'fixed-price' and coalesce("services"."price_amount" > 0, false) and "services"."price_label" is null)
        or ("services"."pricing_model" = 'diagnostic-fee' and coalesce("services"."price_amount" > 0, false) and coalesce(char_length(btrim("services"."price_label")) > 0, false))),
	CONSTRAINT "services_booking_method" CHECK ("services"."booking_method" in ('instant', 'request-appointment', 'request-quote')),
	CONSTRAINT "services_visibility" CHECK ("services"."visibility" in ('public-booking', 'public-only', 'internal')),
	CONSTRAINT "services_intake_shape" CHECK (jsonb_typeof("services"."intake") = 'array')
);
--> statement-breakpoint
ALTER TABLE "services" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "team_activity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"position" integer GENERATED ALWAYS AS IDENTITY (sequence name "team_activity_position_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"ref" text NOT NULL,
	"occurred_at" text NOT NULL,
	"category" text NOT NULL,
	"title" text NOT NULL,
	"detail" text,
	"by_member_id" uuid,
	"job_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "team_activity_ref_unique" UNIQUE("member_id","ref"),
	CONSTRAINT "team_activity_occurred_at" CHECK ("team_activity"."occurred_at" ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$'),
	CONSTRAINT "team_activity_category" CHECK ("team_activity"."category" in ('access', 'availability', 'jobs', 'services')),
	CONSTRAINT "team_activity_title" CHECK (char_length(btrim("team_activity"."title")) between 1 and 200)
);
--> statement-breakpoint
ALTER TABLE "team_activity" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "team_member_availability" (
	"organization_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"day_of_week" smallint NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	"break_start" time,
	"break_end" time,
	CONSTRAINT "team_member_availability_pk" PRIMARY KEY("member_id","day_of_week"),
	CONSTRAINT "team_member_availability_day" CHECK ("team_member_availability"."day_of_week" between 0 and 6),
	CONSTRAINT "team_member_availability_break" CHECK (("team_member_availability"."break_start" is null) = ("team_member_availability"."break_end" is null))
);
--> statement-breakpoint
ALTER TABLE "team_member_availability" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "team_member_services" (
	"organization_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	CONSTRAINT "team_member_services_pk" PRIMARY KEY("member_id","service_id")
);
--> statement-breakpoint
ALTER TABLE "team_member_services" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "team_member_unavailable_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"position" integer GENERATED ALWAYS AS IDENTITY (sequence name "team_member_unavailable_periods_position_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"ref" text NOT NULL,
	"title" text NOT NULL,
	"reason" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"start_time" time,
	"end_time" time,
	CONSTRAINT "team_member_unavailable_ref_unique" UNIQUE("member_id","ref"),
	CONSTRAINT "team_member_unavailable_dates" CHECK ("team_member_unavailable_periods"."end_date" >= "team_member_unavailable_periods"."start_date"),
	CONSTRAINT "team_member_unavailable_times" CHECK (("team_member_unavailable_periods"."start_time" is null) = ("team_member_unavailable_periods"."end_time" is null)),
	CONSTRAINT "team_member_unavailable_title" CHECK (char_length(btrim("team_member_unavailable_periods"."title")) between 1 and 120)
);
--> statement-breakpoint
ALTER TABLE "team_member_unavailable_periods" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "team_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"position" integer GENERATED ALWAYS AS IDENTITY (sequence name "team_members_position_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"slug" text NOT NULL,
	"user_id" text,
	"name" text NOT NULL,
	"job_title" text NOT NULL,
	"title" text,
	"role_id" uuid,
	"email" text,
	"phone" text,
	"status" text DEFAULT 'active' NOT NULL,
	"field_assignable" boolean DEFAULT false NOT NULL,
	"member_since" text,
	"notes" text,
	"service_mode" text DEFAULT 'all' NOT NULL,
	"permission_override" jsonb,
	"availability_mode" text DEFAULT 'business-hours' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "team_members_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "team_members_org_slug_unique" UNIQUE("organization_id","slug"),
	CONSTRAINT "team_members_slug_format" CHECK ("team_members"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length("team_members"."slug") <= 80),
	CONSTRAINT "team_members_name_length" CHECK (char_length(btrim("team_members"."name")) between 1 and 80),
	CONSTRAINT "team_members_status" CHECK ("team_members"."status" in ('active', 'invited', 'inactive')),
	CONSTRAINT "team_members_service_mode" CHECK ("team_members"."service_mode" in ('all', 'selected')),
	CONSTRAINT "team_members_availability_mode" CHECK ("team_members"."availability_mode" in ('business-hours', 'custom', 'not-set')),
	CONSTRAINT "team_members_override_shape" CHECK ("team_members"."permission_override" is null or jsonb_typeof("team_members"."permission_override") = 'object')
);
--> statement-breakpoint
ALTER TABLE "team_members" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "team_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"position" integer GENERATED ALWAYS AS IDENTITY (sequence name "team_roles_position_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"kind" text DEFAULT 'custom' NOT NULL,
	"is_protected" boolean DEFAULT false NOT NULL,
	"permissions" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "team_roles_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "team_roles_org_slug_unique" UNIQUE("organization_id","slug"),
	CONSTRAINT "team_roles_slug_format" CHECK ("team_roles"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length("team_roles"."slug") <= 80),
	CONSTRAINT "team_roles_name_length" CHECK (char_length(btrim("team_roles"."name")) between 1 and 60),
	CONSTRAINT "team_roles_kind" CHECK ("team_roles"."kind" in ('system', 'custom')),
	CONSTRAINT "team_roles_permissions_shape" CHECK (jsonb_typeof("team_roles"."permissions") = 'object')
);
--> statement-breakpoint
ALTER TABLE "team_roles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "customer_notes" ADD CONSTRAINT "customer_notes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_notes" ADD CONSTRAINT "customer_notes_customer_fk" FOREIGN KEY ("organization_id","customer_id") REFERENCES "public"."customers"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_properties" ADD CONSTRAINT "customer_properties_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_properties" ADD CONSTRAINT "customer_properties_customer_fk" FOREIGN KEY ("organization_id","customer_id") REFERENCES "public"."customers"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment" ADD CONSTRAINT "equipment_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment" ADD CONSTRAINT "equipment_property_fk" FOREIGN KEY ("organization_id","property_id") REFERENCES "public"."customer_properties"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_activity" ADD CONSTRAINT "team_activity_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_activity" ADD CONSTRAINT "team_activity_member_fk" FOREIGN KEY ("organization_id","member_id") REFERENCES "public"."team_members"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_activity" ADD CONSTRAINT "team_activity_by_fk" FOREIGN KEY ("organization_id","by_member_id") REFERENCES "public"."team_members"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_member_availability" ADD CONSTRAINT "team_member_availability_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_member_availability" ADD CONSTRAINT "team_member_availability_member_fk" FOREIGN KEY ("organization_id","member_id") REFERENCES "public"."team_members"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_member_services" ADD CONSTRAINT "team_member_services_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_member_services" ADD CONSTRAINT "team_member_services_member_fk" FOREIGN KEY ("organization_id","member_id") REFERENCES "public"."team_members"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_member_services" ADD CONSTRAINT "team_member_services_service_fk" FOREIGN KEY ("organization_id","service_id") REFERENCES "public"."services"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_member_unavailable_periods" ADD CONSTRAINT "team_member_unavailable_periods_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_member_unavailable_periods" ADD CONSTRAINT "team_member_unavailable_member_fk" FOREIGN KEY ("organization_id","member_id") REFERENCES "public"."team_members"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_role_fk" FOREIGN KEY ("organization_id","role_id") REFERENCES "public"."team_roles"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_roles" ADD CONSTRAINT "team_roles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "customer_notes_customer_idx" ON "customer_notes" USING btree ("organization_id","customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_properties_one_primary" ON "customer_properties" USING btree ("organization_id","customer_id") WHERE "customer_properties"."is_primary";--> statement-breakpoint
CREATE INDEX "customer_properties_customer_idx" ON "customer_properties" USING btree ("organization_id","customer_id");--> statement-breakpoint
CREATE INDEX "customers_org_name_idx" ON "customers" USING btree ("organization_id",lower("name"));--> statement-breakpoint
CREATE INDEX "equipment_property_idx" ON "equipment" USING btree ("organization_id","property_id");--> statement-breakpoint
CREATE UNIQUE INDEX "services_org_name_unique" ON "services" USING btree ("organization_id",lower("name"));--> statement-breakpoint
CREATE INDEX "services_org_order_idx" ON "services" USING btree ("organization_id","display_order");--> statement-breakpoint
CREATE INDEX "services_org_active_idx" ON "services" USING btree ("organization_id","is_active");--> statement-breakpoint
CREATE INDEX "team_activity_member_idx" ON "team_activity" USING btree ("organization_id","member_id","occurred_at");--> statement-breakpoint
CREATE INDEX "team_member_services_service_idx" ON "team_member_services" USING btree ("organization_id","service_id");--> statement-breakpoint
CREATE INDEX "team_member_unavailable_member_idx" ON "team_member_unavailable_periods" USING btree ("organization_id","member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "team_members_org_user_unique" ON "team_members" USING btree ("organization_id","user_id") WHERE "team_members"."user_id" is not null;--> statement-breakpoint
CREATE INDEX "team_members_org_status_idx" ON "team_members" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "team_members_role_idx" ON "team_members" USING btree ("organization_id","role_id");--> statement-breakpoint
CREATE UNIQUE INDEX "team_roles_org_name_unique" ON "team_roles" USING btree ("organization_id",lower("name"));
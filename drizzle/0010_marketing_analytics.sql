CREATE TABLE "marketing_campaign_recipients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"customer_id" uuid,
	"recipient_name" text NOT NULL,
	"recipient_email" text,
	"recipient_phone" text,
	"status" text NOT NULL,
	"delivered_at" timestamp with time zone,
	"failure_reason" text,
	"position" integer GENERATED ALWAYS AS IDENTITY (sequence name "marketing_campaign_recipients_position_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaign_recipients_name" CHECK (char_length(btrim("marketing_campaign_recipients"."recipient_name")) between 1 and 200),
	CONSTRAINT "campaign_recipients_status" CHECK ("marketing_campaign_recipients"."status" in ('pending', 'delivered', 'not-delivered')),
	CONSTRAINT "campaign_recipients_result" CHECK (("marketing_campaign_recipients"."status" = 'pending') = ("marketing_campaign_recipients"."delivered_at" is null) and ("marketing_campaign_recipients"."failure_reason" is null or "marketing_campaign_recipients"."status" = 'not-delivered'))
);
--> statement-breakpoint
ALTER TABLE "marketing_campaign_recipients" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "marketing_campaign_selected_customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"position" integer GENERATED ALWAYS AS IDENTITY (sequence name "marketing_campaign_selected_customers_position_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaign_selected_unique" UNIQUE("organization_id","campaign_id","customer_id")
);
--> statement-breakpoint
ALTER TABLE "marketing_campaign_selected_customers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "marketing_campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"summary" text,
	"channel" text NOT NULL,
	"audience_id" text NOT NULL,
	"subject" text,
	"message" text,
	"status" text NOT NULL,
	"scheduled_for" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"sent_on" date,
	"cancelled_at" timestamp with time zone,
	"recipient_count" integer,
	"delivered_count" integer,
	"not_delivered_count" integer,
	"created_by" uuid,
	"position" integer GENERATED ALWAYS AS IDENTITY (sequence name "marketing_campaigns_position_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaigns_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "campaigns_org_slug_unique" UNIQUE("organization_id","slug"),
	CONSTRAINT "campaigns_slug" CHECK ("marketing_campaigns"."slug" ~ '^[a-z0-9][a-z0-9-]{0,119}$'),
	CONSTRAINT "campaigns_name" CHECK (char_length(btrim("marketing_campaigns"."name")) between 1 and 120),
	CONSTRAINT "campaigns_channel" CHECK ("marketing_campaigns"."channel" in ('email', 'sms')),
	CONSTRAINT "campaigns_status" CHECK ("marketing_campaigns"."status" in ('draft', 'scheduled', 'sent')),
	CONSTRAINT "campaigns_audience" CHECK ("marketing_campaigns"."audience_id" in ('all-customers', 'due-for-maintenance', 'maintenance-customers', 'active-plans', 'selected')),
	CONSTRAINT "campaigns_message" CHECK ("marketing_campaigns"."message" is null or (char_length("marketing_campaigns"."message") <= 5000 and ("marketing_campaigns"."channel" = 'email' or char_length("marketing_campaigns"."message") <= 160))),
	CONSTRAINT "campaigns_subject" CHECK ("marketing_campaigns"."subject" is null or ("marketing_campaigns"."channel" = 'email' and char_length("marketing_campaigns"."subject") <= 200)),
	CONSTRAINT "campaigns_scheduled" CHECK (("marketing_campaigns"."status" = 'scheduled') = ("marketing_campaigns"."scheduled_for" is not null)),
	CONSTRAINT "campaigns_sent" CHECK (("marketing_campaigns"."status" = 'sent') = ("marketing_campaigns"."sent_on" is not null) and ("marketing_campaigns"."sent_at" is null or "marketing_campaigns"."status" = 'sent')),
	CONSTRAINT "campaigns_recipient_count" CHECK ("marketing_campaigns"."recipient_count" is null or "marketing_campaigns"."recipient_count" >= 0),
	CONSTRAINT "campaigns_scheduled_count" CHECK ("marketing_campaigns"."status" = 'draft' or "marketing_campaigns"."recipient_count" is not null),
	CONSTRAINT "campaigns_delivery" CHECK (("marketing_campaigns"."delivered_count" is null) = ("marketing_campaigns"."not_delivered_count" is null) and ("marketing_campaigns"."delivered_count" is null or ("marketing_campaigns"."status" = 'sent' and "marketing_campaigns"."delivered_count" >= 0 and "marketing_campaigns"."not_delivered_count" >= 0 and "marketing_campaigns"."delivered_count" + "marketing_campaigns"."not_delivered_count" = "marketing_campaigns"."recipient_count")))
);
--> statement-breakpoint
ALTER TABLE "marketing_campaigns" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "analytics_imported_baselines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"metric_key" text NOT NULL,
	"dimension" text,
	"period_start" date,
	"period_end" date,
	"integer_value" integer,
	"money_cents" integer,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "baselines_unique" UNIQUE NULLS NOT DISTINCT("organization_id","metric_key","dimension","period_start","period_end"),
	CONSTRAINT "baselines_metric_key" CHECK ("analytics_imported_baselines"."metric_key" ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'),
	CONSTRAINT "baselines_dimension" CHECK ("analytics_imported_baselines"."dimension" is null or char_length("analytics_imported_baselines"."dimension") between 1 and 120),
	CONSTRAINT "baselines_period" CHECK (("analytics_imported_baselines"."period_start" is null) = ("analytics_imported_baselines"."period_end" is null) and ("analytics_imported_baselines"."period_start" is null or "analytics_imported_baselines"."period_end" >= "analytics_imported_baselines"."period_start")),
	CONSTRAINT "baselines_value" CHECK (("analytics_imported_baselines"."integer_value" is null) <> ("analytics_imported_baselines"."money_cents" is null)),
	CONSTRAINT "baselines_metadata" CHECK (jsonb_typeof("analytics_imported_baselines"."metadata") = 'object')
);
--> statement-breakpoint
ALTER TABLE "analytics_imported_baselines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "marketing_campaign_recipients" ADD CONSTRAINT "marketing_campaign_recipients_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_campaign_recipients" ADD CONSTRAINT "campaign_recipients_campaign_fk" FOREIGN KEY ("organization_id","campaign_id") REFERENCES "public"."marketing_campaigns"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_campaign_recipients" ADD CONSTRAINT "campaign_recipients_customer_fk" FOREIGN KEY ("organization_id","customer_id") REFERENCES "public"."customers"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_campaign_selected_customers" ADD CONSTRAINT "marketing_campaign_selected_customers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_campaign_selected_customers" ADD CONSTRAINT "campaign_selected_campaign_fk" FOREIGN KEY ("organization_id","campaign_id") REFERENCES "public"."marketing_campaigns"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_campaign_selected_customers" ADD CONSTRAINT "campaign_selected_customer_fk" FOREIGN KEY ("organization_id","customer_id") REFERENCES "public"."customers"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_campaigns" ADD CONSTRAINT "marketing_campaigns_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_campaigns" ADD CONSTRAINT "campaigns_created_by_fk" FOREIGN KEY ("organization_id","created_by") REFERENCES "public"."team_members"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_imported_baselines" ADD CONSTRAINT "analytics_imported_baselines_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_recipients_customer_unique" ON "marketing_campaign_recipients" USING btree ("organization_id","campaign_id","customer_id") WHERE "marketing_campaign_recipients"."customer_id" is not null;--> statement-breakpoint
CREATE INDEX "campaign_recipients_campaign_idx" ON "marketing_campaign_recipients" USING btree ("organization_id","campaign_id","position");--> statement-breakpoint
CREATE INDEX "campaign_recipients_customer_idx" ON "marketing_campaign_recipients" USING btree ("organization_id","customer_id");--> statement-breakpoint
CREATE INDEX "campaign_selected_campaign_idx" ON "marketing_campaign_selected_customers" USING btree ("organization_id","campaign_id");--> statement-breakpoint
CREATE INDEX "campaigns_org_status_idx" ON "marketing_campaigns" USING btree ("organization_id","status","position");--> statement-breakpoint
CREATE INDEX "campaigns_org_sent_idx" ON "marketing_campaigns" USING btree ("organization_id","sent_on");--> statement-breakpoint
CREATE INDEX "baselines_org_metric_idx" ON "analytics_imported_baselines" USING btree ("organization_id","metric_key");
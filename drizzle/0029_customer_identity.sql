ALTER TABLE "bookings" DROP CONSTRAINT "bookings_contact_without_customer";--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "email_key" text GENERATED ALWAYS AS (app_email_key(email)) STORED;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "phone_key" text GENERATED ALWAYS AS (app_phone_key(phone)) STORED;--> statement-breakpoint
CREATE INDEX "customers_org_email_key_idx" ON "customers" USING btree ("organization_id","email_key") WHERE "customers"."email_key" is not null;--> statement-breakpoint
CREATE INDEX "customers_org_phone_key_idx" ON "customers" USING btree ("organization_id","phone_key") WHERE "customers"."phone_key" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "customers_org_identity_unique" ON "customers" USING btree ("organization_id","email_key","phone_key") WHERE "customers"."email_key" is not null and "customers"."phone_key" is not null;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_customer_holds_contact" CHECK ("bookings"."customer_id" is null or ("bookings"."contact_phone" is null and "bookings"."contact_email" is null));
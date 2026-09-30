CREATE TABLE "ad_spend" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"campaign" text,
	"from_date" text NOT NULL,
	"to_date" text NOT NULL,
	"amount_kop" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "analytics_events" ADD COLUMN "ref" text;--> statement-breakpoint
ALTER TABLE "analytics_events" ADD COLUMN "device" text;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "reply" text;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "reply_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "source" text DEFAULT 'site' NOT NULL;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "external_id" text;--> statement-breakpoint
ALTER TABLE "ad_spend" ADD CONSTRAINT "ad_spend_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ad_spend_org_idx" ON "ad_spend" USING btree ("organization_id","from_date");--> statement-breakpoint
CREATE UNIQUE INDEX "reviews_external_uq" ON "reviews" USING btree ("organization_id","source","external_id");
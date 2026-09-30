CREATE TABLE "carts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"session" text NOT NULL,
	"phone" text NOT NULL,
	"name" text,
	"items" jsonb NOT NULL,
	"total_kop" integer NOT NULL,
	"order_id" uuid,
	"recovered" boolean DEFAULT false NOT NULL,
	"closed_at" timestamp with time zone,
	"calls" integer DEFAULT 0 NOT NULL,
	"callback_at" timestamp with time zone,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "carts" ADD CONSTRAINT "carts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carts" ADD CONSTRAINT "carts_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carts" ADD CONSTRAINT "carts_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "carts_site_session_uq" ON "carts" USING btree ("site_id","session");--> statement-breakpoint
CREATE INDEX "carts_org_idx" ON "carts" USING btree ("organization_id","updated_at");
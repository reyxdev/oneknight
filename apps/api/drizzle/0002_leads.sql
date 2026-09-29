CREATE TYPE "public"."lead_status" AS ENUM('new', 'in_progress', 'won', 'lost');--> statement-breakpoint
CREATE TABLE "leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" integer GENERATED ALWAYS AS IDENTITY (sequence name "leads_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1001 CACHE 1),
	"user_id" uuid,
	"organization_id" uuid,
	"name" text NOT NULL,
	"phone" text NOT NULL,
	"email" text,
	"service" text NOT NULL,
	"site_type" text,
	"brief" jsonb NOT NULL,
	"status" "lead_status" DEFAULT 'new' NOT NULL,
	"source" text NOT NULL,
	"locale" text NOT NULL,
	"ip" "inet",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leads_number_unique" UNIQUE("number")
);
--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "leads_user_idx" ON "leads" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "leads_status_idx" ON "leads" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "leads_ip_idx" ON "leads" USING btree ("ip","created_at");
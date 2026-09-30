CREATE TABLE "content_holidays" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"rule" text NOT NULL,
	"kind" text NOT NULL,
	"prep_days" integer DEFAULT 10 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "content_holidays_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "content_ideas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"day" text NOT NULL,
	"time" text NOT NULL,
	"channel" text NOT NULL,
	"also" text[] DEFAULT '{}'::text[] NOT NULL,
	"format" text NOT NULL,
	"bucket" text NOT NULL,
	"template_id" uuid,
	"trigger" text NOT NULL,
	"product_id" uuid,
	"review_id" uuid,
	"promo_id" uuid,
	"holiday" text,
	"site_id" uuid,
	"title" text NOT NULL,
	"why" text NOT NULL,
	"shot" text NOT NULL,
	"text_short" text NOT NULL,
	"text_long" text NOT NULL,
	"cta" text NOT NULL,
	"hashtags" text[] DEFAULT '{}'::text[] NOT NULL,
	"extra" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"link" text,
	"status" text DEFAULT 'todo' NOT NULL,
	"custom" boolean DEFAULT false NOT NULL,
	"locked" boolean DEFAULT false NOT NULL,
	"feedback" smallint,
	"assignee_id" uuid,
	"photos" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_settings" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"generated_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"organization_id" uuid,
	"bucket" text NOT NULL,
	"trigger" text NOT NULL,
	"categories" text[] DEFAULT '{}'::text[] NOT NULL,
	"title" text NOT NULL,
	"why" text NOT NULL,
	"shot" text NOT NULL,
	"short" text NOT NULL,
	"long" text NOT NULL,
	"cta" text NOT NULL,
	"hashtags" text[] DEFAULT '{}'::text[] NOT NULL,
	"hooks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"stories" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"slides" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"article" jsonb,
	"light" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_templates_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "promos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"discount" integer,
	"product_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"starts_on" text NOT NULL,
	"ends_on" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "features" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "promote" text;--> statement-breakpoint
ALTER TABLE "content_ideas" ADD CONSTRAINT "content_ideas_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_ideas" ADD CONSTRAINT "content_ideas_template_id_content_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."content_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_ideas" ADD CONSTRAINT "content_ideas_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_ideas" ADD CONSTRAINT "content_ideas_review_id_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."reviews"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_ideas" ADD CONSTRAINT "content_ideas_promo_id_promos_id_fk" FOREIGN KEY ("promo_id") REFERENCES "public"."promos"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_ideas" ADD CONSTRAINT "content_ideas_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_ideas" ADD CONSTRAINT "content_ideas_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_settings" ADD CONSTRAINT "content_settings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_templates" ADD CONSTRAINT "content_templates_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promos" ADD CONSTRAINT "promos_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "content_ideas_org_day_idx" ON "content_ideas" USING btree ("organization_id","day");--> statement-breakpoint
CREATE INDEX "content_templates_trigger_idx" ON "content_templates" USING btree ("trigger");--> statement-breakpoint
CREATE INDEX "promos_org_idx" ON "promos" USING btree ("organization_id","ends_on");
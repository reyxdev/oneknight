CREATE TYPE "public"."review_moderation" AS ENUM('off', 'manual');--> statement-breakpoint
CREATE TYPE "public"."review_status" AS ENUM('pending', 'published', 'trash');--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"product_id" uuid,
	"order_id" uuid,
	"verified" boolean DEFAULT false NOT NULL,
	"author_name" text NOT NULL,
	"rating" smallint NOT NULL,
	"text" text NOT NULL,
	"consent" boolean NOT NULL,
	"photo_file_id" uuid,
	"video_url" text,
	"status" "review_status" NOT NULL,
	"trashed_at" timestamp with time zone,
	"ip" "inet",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "review_moderation" "review_moderation" DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_photo_file_id_files_id_fk" FOREIGN KEY ("photo_file_id") REFERENCES "public"."files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reviews_site_status_idx" ON "reviews" USING btree ("site_id","status","created_at");--> statement-breakpoint
CREATE INDEX "reviews_org_idx" ON "reviews" USING btree ("organization_id","created_at");
ALTER TABLE "orders" ALTER COLUMN "site_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "source" text DEFAULT 'site' NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "external_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "orders_external_uq" ON "orders" USING btree ("organization_id","source","external_id");
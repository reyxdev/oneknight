CREATE TYPE "public"."payment_status" AS ENUM('unpaid', 'prepaid', 'paid', 'refunded');--> statement-breakpoint
CREATE TABLE "order_statuses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"group" "order_status" NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "orders" DROP CONSTRAINT "orders_number_unique";--> statement-breakpoint
ALTER TABLE "order_events" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "order_statuses" ALTER COLUMN "group" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "status" SET DEFAULT 'new'::text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "payment_status" "payment_status" DEFAULT 'unpaid' NOT NULL;--> statement-breakpoint
UPDATE "orders" SET "payment_status" = 'paid', "status" = 'confirmed' WHERE "status" = 'paid';--> statement-breakpoint
UPDATE "order_events" SET "status" = 'confirmed' WHERE "status" = 'paid';--> statement-breakpoint
DROP TYPE "public"."order_status";--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('new', 'confirmed', 'shipped', 'done', 'cancelled', 'returned');--> statement-breakpoint
ALTER TABLE "order_events" ALTER COLUMN "status" SET DATA TYPE "public"."order_status" USING "status"::"public"."order_status";--> statement-breakpoint
ALTER TABLE "order_statuses" ALTER COLUMN "group" SET DATA TYPE "public"."order_status" USING "group"::"public"."order_status";--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "status" SET DEFAULT 'new'::"public"."order_status";--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "status" SET DATA TYPE "public"."order_status" USING "status"::"public"."order_status";--> statement-breakpoint
ALTER TABLE "order_events" ALTER COLUMN "status" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "number" DROP IDENTITY;--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "number" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "order_events" ADD COLUMN "kind" text DEFAULT 'status' NOT NULL;--> statement-breakpoint
ALTER TABLE "order_events" ADD COLUMN "data" jsonb;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "status_id" uuid;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "cancel_reason" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "prepaid_kop" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "order_seq" integer DEFAULT 1000 NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "order_settings" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "order_statuses" ADD CONSTRAINT "order_statuses_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "order_statuses_org_idx" ON "order_statuses" USING btree ("organization_id","sort");--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_status_id_order_statuses_id_fk" FOREIGN KEY ("status_id") REFERENCES "public"."order_statuses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
UPDATE "orders" o SET "number" = 1000 + r.n FROM (SELECT "id", row_number() OVER (PARTITION BY "organization_id" ORDER BY "created_at", "number") AS n FROM "orders") r WHERE r."id" = o."id";--> statement-breakpoint
UPDATE "organizations" g SET "order_seq" = COALESCE((SELECT max("number") FROM "orders" WHERE "organization_id" = g."id"), 1000);--> statement-breakpoint
CREATE OR REPLACE FUNCTION orders_number() RETURNS trigger AS $$
BEGIN
  IF NEW."number" IS NULL OR NEW."number" = 0 THEN
    UPDATE "organizations" SET "order_seq" = "order_seq" + 1 WHERE "id" = NEW."organization_id" RETURNING "order_seq" INTO NEW."number";
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER orders_number BEFORE INSERT ON "orders" FOR EACH ROW EXECUTE FUNCTION orders_number();--> statement-breakpoint
CREATE UNIQUE INDEX "orders_org_number_uq" ON "orders" USING btree ("organization_id","number");

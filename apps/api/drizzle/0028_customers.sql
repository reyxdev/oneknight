CREATE TABLE "customer_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"user_id" uuid,
	"text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"phone_key" text,
	"phone" text,
	"extra_phones" text[] DEFAULT '{}'::text[] NOT NULL,
	"email" text,
	"company" text,
	"edrpou" text,
	"delivery" jsonb,
	"first_source" text,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"anonymized_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "customer_id" uuid;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "customer_settings" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "customer_notes" ADD CONSTRAINT "customer_notes_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_notes" ADD CONSTRAINT "customer_notes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "customer_notes_idx" ON "customer_notes" USING btree ("customer_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "customers_org_phone_uq" ON "customers" USING btree ("organization_id","phone_key");--> statement-breakpoint
CREATE INDEX "customers_org_idx" ON "customers" USING btree ("organization_id","created_at");--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE OR REPLACE FUNCTION ok_phone_key(p text) RETURNS text AS $$
DECLARE d text := regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g');
BEGIN
  IF length(d) = 10 AND left(d, 1) = '0' THEN d := '38' || d;
  ELSIF length(d) = 9 THEN d := '380' || d;
  END IF;
  IF length(d) < 9 THEN RETURN NULL; END IF;
  RETURN d;
END $$ LANGUAGE plpgsql IMMUTABLE;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION orders_customer() RETURNS trigger AS $$
DECLARE k text; cid uuid;
BEGIN
  IF NEW.is_example THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' AND NEW.customer_id IS NOT NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.customer_phone IS NOT DISTINCT FROM OLD.customer_phone THEN RETURN NEW; END IF;
  k := ok_phone_key(NEW.customer_phone);
  IF k IS NULL THEN RETURN NEW; END IF;
  SELECT id INTO cid FROM customers WHERE organization_id = NEW.organization_id AND (phone_key = k OR k = ANY(extra_phones)) LIMIT 1;
  IF cid IS NULL THEN
    INSERT INTO customers (organization_id, name, phone_key, phone, email, delivery, first_source)
    VALUES (NEW.organization_id, NEW.customer_name, k, NEW.customer_phone, NEW.customer_email, NEW.delivery, NEW.source)
    ON CONFLICT (organization_id, phone_key) DO UPDATE SET updated_at = now()
    RETURNING id INTO cid;
  ELSE
    UPDATE customers SET delivery = NEW.delivery, email = coalesce(email, NEW.customer_email), updated_at = now() WHERE id = cid;
  END IF;
  NEW.customer_id := cid;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER orders_customer BEFORE INSERT OR UPDATE OF customer_phone ON "orders" FOR EACH ROW EXECUTE FUNCTION orders_customer();
--> statement-breakpoint
INSERT INTO "customers" ("organization_id", "name", "phone_key", "phone", "email", "delivery", "first_source", "created_at")
SELECT DISTINCT ON ("organization_id", ok_phone_key("customer_phone")) "organization_id", "customer_name", ok_phone_key("customer_phone"), "customer_phone", "customer_email", "delivery", "source", "created_at"
FROM "orders" WHERE NOT "is_example" AND ok_phone_key("customer_phone") IS NOT NULL
ORDER BY "organization_id", ok_phone_key("customer_phone"), "created_at";
--> statement-breakpoint
UPDATE "orders" o SET "customer_id" = c."id" FROM "customers" c WHERE c."organization_id" = o."organization_id" AND c."phone_key" = ok_phone_key(o."customer_phone") AND NOT o."is_example";

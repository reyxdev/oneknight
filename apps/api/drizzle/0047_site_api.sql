CREATE TABLE "webhook_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"endpoint_id" uuid NOT NULL,
	"event_id" uuid,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_status" integer,
	"last_error" text,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_endpoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"url" text NOT NULL,
	"events" text[] NOT NULL,
	"secret" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"failures" integer DEFAULT 0 NOT NULL,
	"disabled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid,
	"type" text NOT NULL,
	"data" jsonb NOT NULL,
	"dispatched" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "secret_key_hash" text;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "secret_key_hint" text;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "secret_key_created_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "prev_secret_key_hash" text;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "prev_secret_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_endpoint_id_webhook_endpoints_id_fk" FOREIGN KEY ("endpoint_id") REFERENCES "public"."webhook_endpoints"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "webhook_deliveries_due_idx" ON "webhook_deliveries" USING btree ("next_attempt_at") WHERE status = 'pending';--> statement-breakpoint
CREATE INDEX "webhook_deliveries_endpoint_idx" ON "webhook_deliveries" USING btree ("endpoint_id","created_at");--> statement-breakpoint
CREATE INDEX "webhook_endpoints_site_idx" ON "webhook_endpoints" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX "webhook_events_pending_idx" ON "webhook_events" USING btree ("created_at") WHERE not dispatched;--> statement-breakpoint
ALTER TABLE "sites" ADD CONSTRAINT "sites_secret_key_hash_unique" UNIQUE("secret_key_hash");--> statement-breakpoint
-- Webhook events are written by triggers, so every path (site, panel, imports, marketplaces, bulk edits) is covered.
CREATE OR REPLACE FUNCTION ok_webhook_products() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    INSERT INTO webhook_events (organization_id, site_id, type, data) VALUES (OLD.organization_id, OLD.site_id, 'product.changed', jsonb_build_object('productId', OLD.id, 'action', 'deleted'));
    RETURN OLD;
  END IF;
  IF TG_OP = 'INSERT' THEN
    INSERT INTO webhook_events (organization_id, site_id, type, data) VALUES (NEW.organization_id, NEW.site_id, 'product.changed', jsonb_build_object('productId', NEW.id, 'action', 'created'));
    RETURN NEW;
  END IF;
  IF NEW.stock IS DISTINCT FROM OLD.stock OR NEW.availability IS DISTINCT FROM OLD.availability THEN
    INSERT INTO webhook_events (organization_id, site_id, type, data) VALUES (NEW.organization_id, NEW.site_id, 'stock.changed', jsonb_build_object('productId', NEW.id, 'stock', NEW.stock, 'availability', NEW.availability));
  END IF;
  IF (to_jsonb(NEW) - 'updated_at' - 'stock' - 'availability') IS DISTINCT FROM (to_jsonb(OLD) - 'updated_at' - 'stock' - 'availability') THEN
    INSERT INTO webhook_events (organization_id, site_id, type, data) VALUES (NEW.organization_id, NEW.site_id, 'product.changed', jsonb_build_object('productId', NEW.id, 'action', 'updated'));
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER ok_webhook_products AFTER INSERT OR UPDATE OR DELETE ON products FOR EACH ROW EXECUTE FUNCTION ok_webhook_products();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION ok_webhook_categories() RETURNS trigger AS $$
DECLARE r record;
BEGIN
  IF TG_OP = 'DELETE' THEN r := OLD; ELSE r := NEW; END IF;
  INSERT INTO webhook_events (organization_id, site_id, type, data) VALUES (r.organization_id, r.site_id, 'category.changed', jsonb_build_object('categoryId', r.id, 'action', lower(TG_OP)));
  RETURN r;
END $$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER ok_webhook_categories AFTER INSERT OR UPDATE OR DELETE ON product_categories FOR EACH ROW EXECUTE FUNCTION ok_webhook_categories();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION ok_webhook_orders() RETURNS trigger AS $$
BEGIN
  IF NEW.is_example OR NEW.site_id IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    INSERT INTO webhook_events (organization_id, site_id, type, data) VALUES (NEW.organization_id, NEW.site_id, 'order.created', jsonb_build_object('orderId', NEW.id, 'number', NEW.number, 'status', NEW.status, 'paymentStatus', NEW.payment_status));
    RETURN NEW;
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status OR NEW.status_id IS DISTINCT FROM OLD.status_id THEN
    INSERT INTO webhook_events (organization_id, site_id, type, data) VALUES (NEW.organization_id, NEW.site_id, 'order.status_changed', jsonb_build_object('orderId', NEW.id, 'number', NEW.number, 'status', NEW.status, 'previous', OLD.status));
  END IF;
  IF NEW.payment_status IS DISTINCT FROM OLD.payment_status THEN
    INSERT INTO webhook_events (organization_id, site_id, type, data) VALUES (NEW.organization_id, NEW.site_id, 'order.payment_changed', jsonb_build_object('orderId', NEW.id, 'number', NEW.number, 'paymentStatus', NEW.payment_status, 'previous', OLD.payment_status));
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER ok_webhook_orders AFTER INSERT OR UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION ok_webhook_orders();

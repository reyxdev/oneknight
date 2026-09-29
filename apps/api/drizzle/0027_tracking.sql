ALTER TABLE "orders" ADD COLUMN "track_code" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "track_text" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "track_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "arrived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "waiting_notified" boolean DEFAULT false NOT NULL;
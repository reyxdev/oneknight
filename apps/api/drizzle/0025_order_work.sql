ALTER TABLE "orders" ADD COLUMN "assignee_id" uuid;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "callback_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
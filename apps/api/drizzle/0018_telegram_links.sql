CREATE TABLE "telegram_links" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"chat_id" text,
	"username" text,
	"link_token_hash" text,
	"link_expires_at" timestamp with time zone,
	"kinds" text[] DEFAULT '{order,review,site,billing,ticket,team}'::text[] NOT NULL,
	"linked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "telegram_links_chat_id_unique" UNIQUE("chat_id"),
	CONSTRAINT "telegram_links_link_token_hash_unique" UNIQUE("link_token_hash")
);
--> statement-breakpoint
-- Existing notifications count as handled, so linking Telegram never replays history.
ALTER TABLE "notifications" ADD COLUMN "telegram_done" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ALTER COLUMN "telegram_done" SET DEFAULT false;--> statement-breakpoint
ALTER TABLE "telegram_links" ADD CONSTRAINT "telegram_links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notifications_tg_idx" ON "notifications" USING btree ("created_at") WHERE not telegram_done;
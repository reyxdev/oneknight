ALTER TABLE "organizations" ADD COLUMN "goal_kop" integer;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "first_steps_reward_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "ok_seen_at" timestamp with time zone;
ALTER TABLE "orders" ADD COLUMN "is_example" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "onboarding" jsonb;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "trial_reminded" smallint;
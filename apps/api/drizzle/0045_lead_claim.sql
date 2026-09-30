ALTER TABLE "leads" ADD COLUMN "claim_token_hash" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "claim_expires_at" timestamp with time zone;
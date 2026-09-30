ALTER TABLE "users" ADD COLUMN "ref_code" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "referred_by" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "referral_rewarded_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "users_ref_code_uq" ON "users" USING btree ("ref_code");--> statement-breakpoint
CREATE INDEX "users_referred_by_idx" ON "users" USING btree ("referred_by");
CREATE TYPE "public"."access_key_kind" AS ENUM('oneknight', 'module');--> statement-breakpoint
CREATE TYPE "public"."promo_kind" AS ENUM('percent', 'bonus');--> statement-breakpoint
CREATE TABLE "access_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code_hash" text NOT NULL,
	"hint" text NOT NULL,
	"batch" uuid NOT NULL,
	"kind" "access_key_kind" NOT NULL,
	"module_id" text,
	"months" smallint NOT NULL,
	"activate_before" timestamp with time zone,
	"disabled" boolean DEFAULT false NOT NULL,
	"note" text,
	"redeemed_by" uuid,
	"redeemed_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "access_keys_code_hash_unique" UNIQUE("code_hash")
);
--> statement-breakpoint
CREATE TABLE "promo_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"kind" "promo_kind" NOT NULL,
	"value" integer NOT NULL,
	"months" smallint DEFAULT 1 NOT NULL,
	"max_uses" integer,
	"uses" integer DEFAULT 0 NOT NULL,
	"valid_until" timestamp with time zone,
	"active" boolean DEFAULT true NOT NULL,
	"note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "promo_codes_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "promo_redemptions" (
	"promo_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"months_left" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "promo_redemptions_promo_id_organization_id_pk" PRIMARY KEY("promo_id","organization_id")
);
--> statement-breakpoint
ALTER TABLE "module_installs" ADD COLUMN "paid_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "access_keys" ADD CONSTRAINT "access_keys_redeemed_by_organizations_id_fk" FOREIGN KEY ("redeemed_by") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_keys" ADD CONSTRAINT "access_keys_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promo_codes" ADD CONSTRAINT "promo_codes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promo_redemptions" ADD CONSTRAINT "promo_redemptions_promo_id_promo_codes_id_fk" FOREIGN KEY ("promo_id") REFERENCES "public"."promo_codes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promo_redemptions" ADD CONSTRAINT "promo_redemptions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "access_keys_batch_idx" ON "access_keys" USING btree ("batch");
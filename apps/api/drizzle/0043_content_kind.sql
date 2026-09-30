ALTER TABLE "telegram_links" ALTER COLUMN "kinds" SET DEFAULT '{order,review,site,billing,ticket,team,content}'::text[];--> statement-breakpoint
UPDATE "telegram_links" SET "kinds" = array_append("kinds", 'content') WHERE NOT ('content' = ANY("kinds"));

CREATE TABLE "content_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"idea_id" uuid NOT NULL,
	"user_id" uuid,
	"text" text NOT NULL,
	"mentions" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "content_ideas" ADD COLUMN "video" text;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "content_comments" ADD CONSTRAINT "content_comments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_comments" ADD CONSTRAINT "content_comments_idea_id_content_ideas_id_fk" FOREIGN KEY ("idea_id") REFERENCES "public"."content_ideas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_comments" ADD CONSTRAINT "content_comments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "content_comments_idea_idx" ON "content_comments" USING btree ("idea_id","created_at");--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
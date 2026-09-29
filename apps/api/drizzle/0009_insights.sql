CREATE TABLE "insight_dismissals" (
	"organization_id" uuid NOT NULL,
	"insight_id" text NOT NULL,
	"until" timestamp with time zone NOT NULL,
	CONSTRAINT "insight_dismissals_organization_id_insight_id_pk" PRIMARY KEY("organization_id","insight_id")
);
--> statement-breakpoint
ALTER TABLE "insight_dismissals" ADD CONSTRAINT "insight_dismissals_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
CREATE TABLE "canon_domains" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"conventions" text,
	"guidelines" text,
	"architecture" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "domain_id" uuid;--> statement-breakpoint
ALTER TABLE "canon_domains" ADD CONSTRAINT "canon_domains_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "canon_domains_user_slug_idx" ON "canon_domains" USING btree ("user_id","slug");--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_domain_id_canon_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."canon_domains"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "projects_domain_idx" ON "projects" USING btree ("domain_id");--> statement-breakpoint
INSERT INTO "canon_domains" ("user_id", "slug", "name", "conventions", "guidelines", "architecture")
SELECT "user_id", 'default', 'Default', "conventions", "guidelines", "architecture"
FROM "user_canon"
WHERE "conventions" IS NOT NULL OR "guidelines" IS NOT NULL OR "architecture" IS NOT NULL;--> statement-breakpoint
DROP TABLE "user_canon";
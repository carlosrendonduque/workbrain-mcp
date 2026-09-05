CREATE TABLE "destruction_certificates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"client_slug" text NOT NULL,
	"client_name" text NOT NULL,
	"project_slugs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"removed" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"documents_digest" text NOT NULL,
	"storage" text NOT NULL,
	"issued_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "destruction_certificates" ADD CONSTRAINT "destruction_certificates_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "destruction_certs_client_idx" ON "destruction_certificates" USING btree ("client_slug");
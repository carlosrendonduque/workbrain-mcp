CREATE TABLE "draft_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"proposed_type" text NOT NULL,
	"proposed_title" text NOT NULL,
	"proposed_content" text NOT NULL,
	"proposed_external_id" text,
	"proposed_frontmatter" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"proposal_note" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"proposed_by" text DEFAULT 'agent' NOT NULL,
	"approved_document_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"reviewed_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "draft_documents" ADD CONSTRAINT "draft_documents_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_documents" ADD CONSTRAINT "draft_documents_approved_document_id_documents_id_fk" FOREIGN KEY ("approved_document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "draft_documents_project_status_idx" ON "draft_documents" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX "draft_documents_created_at_idx" ON "draft_documents" USING btree ("created_at");
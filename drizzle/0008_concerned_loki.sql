ALTER TABLE "invocations" ADD COLUMN "activity_kind" text;--> statement-breakpoint
ALTER TABLE "invocations" ADD COLUMN "target_external_id" text;--> statement-breakpoint
ALTER TABLE "invocations" ADD COLUMN "session_id" text;--> statement-breakpoint
CREATE INDEX "invocations_session_idx" ON "invocations" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "invocations_project_kind_created_idx" ON "invocations" USING btree ("project_id","activity_kind","created_at");
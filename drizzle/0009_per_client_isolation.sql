ALTER TABLE "clients" ADD COLUMN "isolation_mode" text DEFAULT 'shared' NOT NULL;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "corpus_db_url_env" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "llm_provider" text DEFAULT 'anthropic' NOT NULL;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "llm_config" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "embedding_provider" text DEFAULT 'voyage' NOT NULL;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "embedding_config" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "retention_days" integer;
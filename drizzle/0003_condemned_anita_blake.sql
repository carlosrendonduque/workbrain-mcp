CREATE TABLE "user_canon" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"conventions" text,
	"guidelines" text,
	"architecture" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_canon" ADD CONSTRAINT "user_canon_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
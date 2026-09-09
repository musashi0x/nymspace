CREATE TABLE "page_views" (
	"id" text PRIMARY KEY NOT NULL,
	"visitor_id" text NOT NULL,
	"path" text NOT NULL,
	"is_bot" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "page_views_created_at_idx" ON "page_views" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "page_views_visitor_idx" ON "page_views" USING btree ("visitor_id","is_bot");
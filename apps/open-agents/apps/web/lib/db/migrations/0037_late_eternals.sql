CREATE TABLE "knowledge_gaps" (
	"id" text PRIMARY KEY NOT NULL,
	"dedup_hash" text NOT NULL,
	"kind" text NOT NULL,
	"severity" text DEFAULT 'medium' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"tool_name" text,
	"error_message" text NOT NULL,
	"attempted_input" jsonb,
	"hypothesis" text NOT NULL,
	"hypothesis_norm" text NOT NULL,
	"suggested_fix" text,
	"blocking_pr" boolean DEFAULT false NOT NULL,
	"occurrence_count" integer DEFAULT 1 NOT NULL,
	"first_seen_at" timestamp DEFAULT now() NOT NULL,
	"last_seen_at" timestamp DEFAULT now() NOT NULL,
	"session_id" text,
	"repo_slug" text,
	"branch_ref" text,
	"pr_url" text,
	"risk_tier" text,
	"surface" text,
	"resolution_pr_url" text,
	"fix_summary" text,
	"must_mention" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"resolved_at" timestamp,
	"board_column" text DEFAULT 'open' NOT NULL,
	"board_position" integer DEFAULT 0 NOT NULL,
	"auto_execute_on_in_progress" boolean DEFAULT false NOT NULL,
	"linear_issue_id" text,
	"last_execution_session_id" text,
	"last_execution_status" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "knowledge_gaps_dedup_hash_unique" UNIQUE("dedup_hash")
);
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "bufi_callback_url" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "bufi_callback_secret" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "bufi_callback_fired_at" timestamp;--> statement-breakpoint
CREATE INDEX "idx_knowledge_gaps_board" ON "knowledge_gaps" USING btree ("board_column","board_position");--> statement-breakpoint
CREATE INDEX "idx_knowledge_gaps_status_severity" ON "knowledge_gaps" USING btree ("status","severity");--> statement-breakpoint
CREATE INDEX "idx_knowledge_gaps_last_seen" ON "knowledge_gaps" USING btree ("last_seen_at");
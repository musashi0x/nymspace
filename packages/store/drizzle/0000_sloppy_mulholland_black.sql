CREATE TABLE "activity_events" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text,
	"organization_id" text NOT NULL,
	"source" text NOT NULL,
	"type" text NOT NULL,
	"status" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"actor" text,
	"tx_hash" text,
	"external_id" text,
	"summary" text NOT NULL,
	"evidence" jsonb NOT NULL,
	"metadata" jsonb,
	CONSTRAINT "activity_events_status_check" CHECK ("activity_events"."status" in ('pending', 'success', 'denied', 'failed')),
	CONSTRAINT "activity_events_source_check" CHECK ("activity_events"."source" in ('ens', 'erc8004', 'graph', 'privy', 'app'))
);
--> statement-breakpoint
CREATE TABLE "agent_provisioning" (
	"agent_id" text PRIMARY KEY NOT NULL,
	"ens" text DEFAULT 'draft' NOT NULL,
	"erc8004" text DEFAULT 'unregistered' NOT NULL,
	"ensip25" text DEFAULT 'unchecked' NOT NULL,
	"graph" text DEFAULT 'not_indexed' NOT NULL,
	"financial" text DEFAULT 'no_wallet' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agents" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"slug" text NOT NULL,
	"ens_name" text NOT NULL,
	"controller_address" text NOT NULL,
	"erc8004_agent_id" text,
	"erc8004_registry" text,
	"privy_wallet_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agents_org_slug_unique" UNIQUE("organization_id","slug")
);
--> statement-breakpoint
CREATE TABLE "financial_authority" (
	"agent_id" text PRIMARY KEY NOT NULL,
	"privy_wallet_id" text NOT NULL,
	"wallet_address" text NOT NULL,
	"policy_id" text,
	"policy_label" text
);
--> statement-breakpoint
CREATE TABLE "graph_snapshots" (
	"agent_id" text PRIMARY KEY NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"chain_id" integer NOT NULL,
	"graph_agent_key" text NOT NULL,
	"subgraph_id" text NOT NULL,
	"registration_file" jsonb,
	"feedback_count" integer,
	"validation_count" integer
);
--> statement-breakpoint
CREATE TABLE "identity_snapshots" (
	"agent_id" text PRIMARY KEY NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"owner" text NOT NULL,
	"resolver" text NOT NULL,
	"context" text,
	"mcp_endpoint" text,
	"a2a_endpoint" text,
	"web_endpoint" text,
	"ensip25_status" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" text PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"parent_ens_name" text NOT NULL,
	"chain_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_provisioning" ADD CONSTRAINT "agent_provisioning_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_authority" ADD CONSTRAINT "financial_authority_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graph_snapshots" ADD CONSTRAINT "graph_snapshots_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_snapshots" ADD CONSTRAINT "identity_snapshots_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_events_occurred_at_idx" ON "activity_events" USING btree ("occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "activity_events_agent_idx" ON "activity_events" USING btree ("agent_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "activity_events_filter_idx" ON "activity_events" USING btree ("source","type","status");
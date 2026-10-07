CREATE TABLE "alerts" (
	"id" serial PRIMARY KEY NOT NULL,
	"facility_id" text NOT NULL,
	"covenant_index" integer,
	"kind" text NOT NULL,
	"audience" text DEFAULT 'both' NOT NULL,
	"severity" text DEFAULT 'info' NOT NULL,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"test_id" integer,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "covenant_tests" (
	"id" serial PRIMARY KEY NOT NULL,
	"facility_id" text NOT NULL,
	"covenant_index" integer NOT NULL,
	"sequence" integer NOT NULL,
	"kind" text NOT NULL,
	"tested_at" text NOT NULL,
	"breached" boolean NOT NULL,
	"status" text NOT NULL,
	"source_urls" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"citation" text DEFAULT '' NOT NULL,
	"locator" text DEFAULT '' NOT NULL,
	"as_of" text DEFAULT '' NOT NULL,
	"numerator_milli" numeric(78, 0) DEFAULT '0' NOT NULL,
	"denominator_milli" numeric(78, 0) DEFAULT '0' NOT NULL,
	"observed_bp" integer DEFAULT 0 NOT NULL,
	"observed_atto" numeric(78, 0) DEFAULT '0' NOT NULL,
	"threshold_bp" integer DEFAULT 0 NOT NULL,
	"narrative" text DEFAULT '' NOT NULL,
	"consequence_applied" text DEFAULT '' NOT NULL,
	"tx_hash" text,
	"validator_votes" jsonb,
	"leader_address" text,
	"triggered_by" text DEFAULT 'schedule' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "covenant_tests_identity_key" UNIQUE("facility_id","covenant_index","sequence")
);
--> statement-breakpoint
CREATE TABLE "covenants" (
	"id" serial PRIMARY KEY NOT NULL,
	"facility_id" text NOT NULL,
	"covenant_index" integer NOT NULL,
	"text" text NOT NULL,
	"kind" text NOT NULL,
	"metric" text DEFAULT '' NOT NULL,
	"numerator_label" text DEFAULT '' NOT NULL,
	"denominator_label" text DEFAULT '' NOT NULL,
	"threshold_bp" integer DEFAULT 0 NOT NULL,
	"threshold_atto" numeric(78, 0) DEFAULT '0' NOT NULL,
	"comparator" text NOT NULL,
	"test_frequency_hours" integer NOT NULL,
	"cure_period_hours" integer DEFAULT 0 NOT NULL,
	"filing_deadline_days" integer DEFAULT 0 NOT NULL,
	"breach_consequence" text NOT NULL,
	"source_urls" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'untested' NOT NULL,
	"observed_bp" integer DEFAULT 0 NOT NULL,
	"observed_atto" numeric(78, 0) DEFAULT '0' NOT NULL,
	"evidence_ref" text DEFAULT '' NOT NULL,
	"last_tested_at" text DEFAULT '' NOT NULL,
	"next_due_at" text DEFAULT '' NOT NULL,
	"cure_deadline" text DEFAULT '' NOT NULL,
	"test_count" integer DEFAULT 0 NOT NULL,
	"breach_count" integer DEFAULT 0 NOT NULL,
	"appeal_status" text DEFAULT 'none' NOT NULL,
	"appeal_bond_atto" numeric(78, 0) DEFAULT '0' NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "covenants_facility_index_key" UNIQUE("facility_id","covenant_index")
);
--> statement-breakpoint
CREATE TABLE "facilities" (
	"facility_id" text PRIMARY KEY NOT NULL,
	"lender_address" text NOT NULL,
	"borrower_address" text NOT NULL,
	"borrower_name" text NOT NULL,
	"purpose" text DEFAULT '' NOT NULL,
	"principal_atto" numeric(78, 0) NOT NULL,
	"rate_bp" integer NOT NULL,
	"step_up_bp" integer NOT NULL,
	"status" text NOT NULL,
	"treasury_rpc_url" text DEFAULT '' NOT NULL,
	"treasury_address" text DEFAULT '' NOT NULL,
	"governance_url" text DEFAULT '' NOT NULL,
	"chain_created_at" text NOT NULL,
	"created_tx" text,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "positions" (
	"facility_id" text PRIMARY KEY NOT NULL,
	"committed_atto" numeric(78, 0) DEFAULT '0' NOT NULL,
	"drawn_atto" numeric(78, 0) DEFAULT '0' NOT NULL,
	"accrued_interest_atto" numeric(78, 0) DEFAULT '0' NOT NULL,
	"effective_rate_bp" integer DEFAULT 0 NOT NULL,
	"draw_frozen" boolean DEFAULT false NOT NULL,
	"accelerated" boolean DEFAULT false NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sweeps" (
	"id" serial PRIMARY KEY NOT NULL,
	"trigger" text DEFAULT 'cron' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"due_count" integer DEFAULT 0 NOT NULL,
	"tested_count" integer DEFAULT 0 NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"detail" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"privy_did" text NOT NULL,
	"email" text NOT NULL,
	"genlayer_address" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_privy_did_key" UNIQUE("privy_did"),
	CONSTRAINT "users_email_key" UNIQUE("email"),
	CONSTRAINT "users_genlayer_address_key" UNIQUE("genlayer_address")
);
--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_facility_id_facilities_facility_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("facility_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_test_id_covenant_tests_id_fk" FOREIGN KEY ("test_id") REFERENCES "public"."covenant_tests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "covenant_tests" ADD CONSTRAINT "covenant_tests_facility_id_facilities_facility_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("facility_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "covenants" ADD CONSTRAINT "covenants_facility_id_facilities_facility_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("facility_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_facility_id_facilities_facility_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("facility_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "alerts_facility_idx" ON "alerts" USING btree ("facility_id");--> statement-breakpoint
CREATE INDEX "alerts_unread_idx" ON "alerts" USING btree ("read_at");--> statement-breakpoint
CREATE INDEX "covenant_tests_facility_idx" ON "covenant_tests" USING btree ("facility_id","covenant_index");--> statement-breakpoint
CREATE INDEX "covenant_tests_created_idx" ON "covenant_tests" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "covenants_status_idx" ON "covenants" USING btree ("status");--> statement-breakpoint
CREATE INDEX "covenants_next_due_idx" ON "covenants" USING btree ("next_due_at");--> statement-breakpoint
CREATE INDEX "facilities_lender_idx" ON "facilities" USING btree ("lender_address");--> statement-breakpoint
CREATE INDEX "facilities_borrower_idx" ON "facilities" USING btree ("borrower_address");
/**
 * Postgres schema for Covenant.
 *
 * The contracts are the source of truth for every figure a user acts on:
 * principal, drawn balance, observed ratios, covenant status. This database
 * holds three things the chain cannot hold cheaply or at all.
 *
 *  1. The identity mapping. A Privy user's email and DID against the GenLayer
 *     address derived for them, so a facility's `lender` and `borrower`
 *     addresses can be shown as people.
 *  2. A read model. Reading a portfolio straight from chain means one call per
 *     facility per covenant, which is too slow for a console and runs into
 *     studionet's rate limit. These tables are a cache, refreshed from chain,
 *     and every row records when it was last synced.
 *  3. The evidence chain. `covenant_tests` keeps the full citation payload for
 *     every test ever run: which URLs were read, which figures came out, what
 *     the sandbox computed, how the validators voted. The contract keeps only
 *     the latest finding per covenant, because storing the history on chain
 *     would be unbounded. This is the audit trail.
 *
 * Numeric columns that hold wei-scale values use numeric(78, 0), which covers
 * the full u256 range, and Drizzle hands them back as strings so nothing is
 * silently truncated through a JavaScript number.
 */
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

/** Mirrors u256 on chain. Kept as a string end to end. */
const atto = (name: string) => numeric(name, { precision: 78, scale: 0 });

// ---------------------------------------------------------------- identity

export const users = pgTable(
  "users",
  {
    id: serial("id").primaryKey(),
    /** Privy decentralised identifier, the stable handle for a signed in user. */
    privyDid: text("privy_did").notNull(),
    email: text("email").notNull(),
    /**
     * GenLayer address derived from the master secret and the Privy DID. It is
     * recomputed on demand and never stored as a key, only as this address, so
     * that a facility's counterparties can be resolved back to people.
     */
    genlayerAddress: text("genlayer_address").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("users_privy_did_key").on(table.privyDid),
    unique("users_email_key").on(table.email),
    unique("users_genlayer_address_key").on(table.genlayerAddress),
  ],
);

// ---------------------------------------------------------------- facility

export const facilities = pgTable(
  "facilities",
  {
    /** The same id the registry uses on chain. */
    facilityId: text("facility_id").primaryKey(),
    lenderAddress: text("lender_address").notNull(),
    borrowerAddress: text("borrower_address").notNull(),
    borrowerName: text("borrower_name").notNull(),
    purpose: text("purpose").notNull().default(""),
    principalAtto: atto("principal_atto").notNull(),
    rateBp: integer("rate_bp").notNull(),
    stepUpBp: integer("step_up_bp").notNull(),
    /** active | draw_stopped | accelerating | closed */
    status: text("status").notNull(),
    treasuryRpcUrl: text("treasury_rpc_url").notNull().default(""),
    treasuryAddress: text("treasury_address").notNull().default(""),
    governanceUrl: text("governance_url").notNull().default(""),
    /** Block clock value from the registry, not the row's insert time. */
    chainCreatedAt: text("chain_created_at").notNull(),
    createdTx: text("created_tx"),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("facilities_lender_idx").on(table.lenderAddress),
    index("facilities_borrower_idx").on(table.borrowerAddress),
  ],
);

/** Vault position. Separate from the facility because the vault owns it. */
export const positions = pgTable("positions", {
  facilityId: text("facility_id")
    .primaryKey()
    .references(() => facilities.facilityId, { onDelete: "cascade" }),
  committedAtto: atto("committed_atto").notNull().default("0"),
  drawnAtto: atto("drawn_atto").notNull().default("0"),
  accruedInterestAtto: atto("accrued_interest_atto").notNull().default("0"),
  effectiveRateBp: integer("effective_rate_bp").notNull().default(0),
  drawFrozen: boolean("draw_frozen").notNull().default(false),
  accelerated: boolean("accelerated").notNull().default(false),
  syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
});

// --------------------------------------------------------------- covenants

export const covenants = pgTable(
  "covenants",
  {
    id: serial("id").primaryKey(),
    facilityId: text("facility_id")
      .notNull()
      .references(() => facilities.facilityId, { onDelete: "cascade" }),
    /** Position in the facility's covenant array on chain. */
    covenantIndex: integer("covenant_index").notNull(),

    /** The promise as the lender wrote it. */
    text: text("text").notNull(),
    /** ratio | filing | prose | treasury */
    kind: text("kind").notNull(),
    metric: text("metric").notNull().default(""),
    numeratorLabel: text("numerator_label").notNull().default(""),
    denominatorLabel: text("denominator_label").notNull().default(""),
    thresholdBp: integer("threshold_bp").notNull().default(0),
    thresholdAtto: atto("threshold_atto").notNull().default("0"),
    /** gte | lte */
    comparator: text("comparator").notNull(),
    testFrequencyHours: integer("test_frequency_hours").notNull(),
    curePeriodHours: integer("cure_period_hours").notNull().default(0),
    filingDeadlineDays: integer("filing_deadline_days").notNull().default(0),
    /** draw_stop | rate_step_up | acceleration */
    breachConsequence: text("breach_consequence").notNull(),
    sourceUrls: jsonb("source_urls").$type<string[]>().notNull().default([]),

    /** untested | compliant | breach_pending_cure | breached | cured */
    status: text("status").notNull().default("untested"),
    observedBp: integer("observed_bp").notNull().default(0),
    observedAtto: atto("observed_atto").notNull().default("0"),
    evidenceRef: text("evidence_ref").notNull().default(""),
    lastTestedAt: text("last_tested_at").notNull().default(""),
    nextDueAt: text("next_due_at").notNull().default(""),
    cureDeadline: text("cure_deadline").notNull().default(""),
    testCount: integer("test_count").notNull().default(0),
    breachCount: integer("breach_count").notNull().default(0),
    /** none | open | upheld | overturned */
    appealStatus: text("appeal_status").notNull().default("none"),
    appealBondAtto: atto("appeal_bond_atto").notNull().default("0"),

    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("covenants_facility_index_key").on(table.facilityId, table.covenantIndex),
    index("covenants_status_idx").on(table.status),
    index("covenants_next_due_idx").on(table.nextDueAt),
  ],
);

// ----------------------------------------------------------------- evidence

/**
 * One row per covenant test, kept forever.
 *
 * The anti-hallucination rule in the contracts is "cite the artifact, not the
 * conclusion", and this table is where that citation is preserved. A reader
 * should be able to follow a breach back from the consequence to the sentence
 * in a filing that caused it, without taking anyone's word for a step.
 */
export const covenantTests = pgTable(
  "covenant_tests",
  {
    id: serial("id").primaryKey(),
    facilityId: text("facility_id")
      .notNull()
      .references(() => facilities.facilityId, { onDelete: "cascade" }),
    covenantIndex: integer("covenant_index").notNull(),
    /** The monitor's own counter for this covenant's tests. */
    sequence: integer("sequence").notNull(),
    kind: text("kind").notNull(),
    /** Block clock value the contract tested against. */
    testedAt: text("tested_at").notNull(),
    breached: boolean("breached").notNull(),
    status: text("status").notNull(),

    // What was read, and what the sandbox computed from it.
    sourceUrls: jsonb("source_urls").$type<string[]>().notNull().default([]),
    /** Identifier of the artifact the validators agreed on. */
    citation: text("citation").notNull().default(""),
    /** Where in that artifact the figures were found. */
    locator: text("locator").notNull().default(""),
    /** Publication date of the artifact, as opposed to when it was read. */
    asOf: text("as_of").notNull().default(""),
    numeratorMilli: atto("numerator_milli").notNull().default("0"),
    denominatorMilli: atto("denominator_milli").notNull().default("0"),
    observedBp: integer("observed_bp").notNull().default(0),
    observedAtto: atto("observed_atto").notNull().default("0"),
    thresholdBp: integer("threshold_bp").notNull().default(0),
    /** Human readable account of the test, rendered by the contract. */
    narrative: text("narrative").notNull().default(""),
    consequenceApplied: text("consequence_applied").notNull().default(""),

    // How the network reached it.
    txHash: text("tx_hash"),
    /** Per validator vote, as the receipt reported it. */
    validatorVotes: jsonb("validator_votes").$type<Record<string, string>>(),
    leaderAddress: text("leader_address"),
    /** schedule | manual | api */
    triggeredBy: text("triggered_by").notNull().default("schedule"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("covenant_tests_identity_key").on(
      table.facilityId,
      table.covenantIndex,
      table.sequence,
    ),
    index("covenant_tests_facility_idx").on(table.facilityId, table.covenantIndex),
    index("covenant_tests_created_idx").on(table.createdAt),
  ],
);

// ------------------------------------------------------------------ alerts

export const alerts = pgTable(
  "alerts",
  {
    id: serial("id").primaryKey(),
    facilityId: text("facility_id")
      .notNull()
      .references(() => facilities.facilityId, { onDelete: "cascade" }),
    covenantIndex: integer("covenant_index"),
    /** breach | cure_open | cure_lapsed | appeal | enforcement | draw_blocked */
    kind: text("kind").notNull(),
    /** lender | borrower | both */
    audience: text("audience").notNull().default("both"),
    severity: text("severity").notNull().default("info"),
    title: text("title").notNull(),
    body: text("body").notNull().default(""),
    /** The test that raised it, when there was one. */
    testId: integer("test_id").references(() => covenantTests.id, {
      onDelete: "set null",
    }),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("alerts_facility_idx").on(table.facilityId),
    index("alerts_unread_idx").on(table.readAt),
  ],
);

// ------------------------------------------------------------------ sweeps

/** One row per scheduler pass, so a missed test can be explained. */
export const sweeps = pgTable("sweeps", {
  id: serial("id").primaryKey(),
  /** cron | manual */
  trigger: text("trigger").notNull().default("cron"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  dueCount: integer("due_count").notNull().default(0),
  testedCount: integer("tested_count").notNull().default(0),
  failedCount: integer("failed_count").notNull().default(0),
  /** Per covenant outcome, so a partial sweep is debuggable. */
  detail: jsonb("detail").$type<SweepDetail[]>().notNull().default([]),
  error: text("error"),
});

export type SweepDetail = {
  facilityId: string;
  covenantIndex: number;
  outcome: "tested" | "failed" | "skipped";
  status?: string;
  txHash?: string;
  message?: string;
};

export type User = typeof users.$inferSelect;
export type Facility = typeof facilities.$inferSelect;
export type Position = typeof positions.$inferSelect;
export type Covenant = typeof covenants.$inferSelect;
export type CovenantTest = typeof covenantTests.$inferSelect;
export type Alert = typeof alerts.$inferSelect;
export type Sweep = typeof sweeps.$inferSelect;

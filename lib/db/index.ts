/**
 * Drizzle client over Neon's HTTP driver.
 *
 * The HTTP driver suits route handlers: no pool to keep warm, no connection to
 * leak when a serverless invocation is frozen mid request. It does not support
 * interactive transactions, which is why the write paths in this app are
 * written as single statements or as idempotent upserts rather than as
 * multi-statement transactions.
 */
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { databaseUrl } from "@/lib/env";
import * as schema from "./schema";

export type Database = ReturnType<typeof drizzle<typeof schema>>;

let cached: Database | undefined;

/** Lazily built so importing this module never needs DATABASE_URL present. */
export function db(): Database {
  if (!cached) {
    cached = drizzle(neon(databaseUrl()), { schema });
  }
  return cached;
}

export * from "./schema";

/**
 * Prints what is actually in the database.
 *
 * Run with `npm run db:verify`. A migration tool reporting success is not the
 * same as the tables existing, and this is the cheapest way to tell the
 * difference. Also useful for confirming a row count after a sync.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import "../lib/net.ts";
import { neon } from "@neondatabase/serverless";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set; see .env.example");
const sql = neon(url);

const tables = await sql`
  select t.table_name as name,
         (select count(*) from information_schema.columns c
           where c.table_name = t.table_name and c.table_schema = 'public') as columns
  from information_schema.tables t
  where t.table_schema = 'public' and t.table_type = 'BASE TABLE'
  order by t.table_name`;

console.table(tables);

const [counts] = await sql`
  select (select count(*)::int from pg_indexes where schemaname = 'public') as indexes,
         (select count(*)::int from information_schema.table_constraints
           where table_schema = 'public' and constraint_type = 'FOREIGN KEY') as foreign_keys`;
console.log(`indexes ${counts!.indexes}, foreign keys ${counts!.foreign_keys}`);

// Row counts, so a sync or a sweep can be confirmed to have written something.
const rows: Array<{ table: string; rows: number }> = [];
for (const table of tables) {
  const name = (table as { name: string }).name;
  if (name === "__drizzle_migrations") continue;
  const [row] = await sql.query(`select count(*)::int as n from "${name}"`);
  rows.push({ table: name, rows: (row as { n: number }).n });
}
console.table(rows);

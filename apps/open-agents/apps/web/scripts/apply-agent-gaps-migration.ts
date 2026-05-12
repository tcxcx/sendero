#!/usr/bin/env bun
/**
 * One-shot apply of 0037_late_eternals.sql (knowledge_gaps table).
 *
 * Bypasses the Drizzle migration tracker because earlier migrations in
 * the journal conflict with the current DB state (sessions.bufi_callback_url
 * already exists). This script is idempotent — uses IF NOT EXISTS guards.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

const url = process.env.POSTGRES_URL;
if (!url) {
  console.error("POSTGRES_URL required");
  process.exit(1);
}

const sqlPath = join(
  import.meta.dir,
  "..",
  "lib",
  "db",
  "migrations",
  "0037_late_eternals.sql",
);
const raw = readFileSync(sqlPath, "utf8");

// drizzle-kit folded three sessions.bufi_callback_* ALTERs into our 0037
// because the migration journal lost track of them (they already exist in
// DB). Strip those — they're pre-existing drift, not new schema.
const stripped = raw
  .split("--> statement-breakpoint")
  .filter(
    (stmt) => !/ALTER TABLE "sessions" ADD COLUMN "bufi_callback/.test(stmt),
  )
  .join("--> statement-breakpoint");

// Wrap CREATE TABLE + indexes in idempotency guards.
const guarded = stripped
  .replace(
    /CREATE TABLE "knowledge_gaps"/,
    'CREATE TABLE IF NOT EXISTS "knowledge_gaps"',
  )
  .replace(/CREATE INDEX "/g, 'CREATE INDEX IF NOT EXISTS "');

const client = postgres(url, { max: 1 });
try {
  console.log("Applying agent-gaps migration…");
  await client.unsafe(guarded);

  // Record in the Drizzle migrations table so future drizzle-kit runs
  // don't try to re-apply it.
  const hash = "agent_gaps_0037_late_eternals";
  await client.unsafe(`
    CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    );
  `);
  await client.unsafe(
    `
    INSERT INTO "drizzle"."__drizzle_migrations" (hash, created_at)
    SELECT $1, $2
    WHERE NOT EXISTS (
      SELECT 1 FROM "drizzle"."__drizzle_migrations" WHERE hash = $1
    );
  `,
    [hash, Date.now()],
  );

  const cols = await client`
    SELECT count(*)::int AS n
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'knowledge_gaps'
  `;
  console.log(`OK — knowledge_gaps has ${cols[0]?.n ?? 0} columns`);
} finally {
  await client.end();
}

import "server-only";
import postgres from "postgres";
import type { Db, Q } from "@/lib/ingest/db";

// Privileged SQL for routes that reuse the ingest pipeline (webhook). Needs SUPABASE_DB_URL (server only).
let sql: postgres.Sql | null = null;

export function serverDb(): Db | null {
  const url = process.env.SUPABASE_DB_URL;
  if (!url) return null;
  sql ??= postgres(url, { max: 2, prepare: false });
  const wrap = (s: postgres.Sql | postgres.TransactionSql): Q => (async (text: string, params: unknown[] = []) => (await s.unsafe(text, params as never[])) as never) as Q;
  return { q: wrap(sql), tx: (fn) => sql!.begin((t) => fn(wrap(t))) as never };
}

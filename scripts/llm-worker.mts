// Local worker for the LLM queue (F-04.4, OQ-3): run on the owner's computer next to 9router.
// Usage: npm run llm-worker            (loops every 60 s)
//        npm run llm-worker -- --once
import postgres from "postgres";
import { processLlmJobs } from "../src/lib/ingest/pipeline";
import { llmConfigFromEnv } from "../src/lib/ingest/llm";
import type { Db, Q } from "../src/lib/ingest/db";

const url = process.env.SUPABASE_DB_URL;
if (!url) {
  console.error("Isi SUPABASE_DB_URL (lokal: postgresql://postgres:postgres@127.0.0.1:54322/postgres).");
  process.exit(1);
}
const sql = postgres(url, { max: 2, prepare: false });
const wrap = (s: postgres.Sql | postgres.TransactionSql): Q => (async (text: string, params: unknown[] = []) => (await s.unsafe(text, params as never[])) as never) as Q;
const db: Db = { q: wrap(sql), tx: (fn) => sql.begin((t) => fn(wrap(t))) as never };

async function once() {
  const r = await processLlmJobs(db, { googleClientId: "", googleClientSecret: "", llm: llmConfigFromEnv(process.env), fetchFn: fetch, now: () => new Date() });
  console.log(new Date().toISOString(), JSON.stringify(r));
}

if (process.argv.includes("--once")) {
  await once();
  await sql.end();
} else {
  for (;;) {
    await once().catch((e) => console.error("worker error", (e as Error).name));
    await new Promise((r) => setTimeout(r, 60_000));
  }
}

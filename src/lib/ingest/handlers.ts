// HTTP entry points for the Supabase Edge Functions (API-15, API-16, API-41). Runtime-agnostic.
import { secretEquals, type Db } from "./db";
import { llmConfigFromEnv } from "./llm";
import { maintenance, processLlmJobs, runGmail, type IngestEnv } from "./pipeline";
import { vapidFromEnv } from "./push";

type Env = Record<string, string | undefined>;

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const unauthorized = () => json(401, { error: { code: "RAHASIA_SALAH", message: "Rahasia cron salah.", request_id: crypto.randomUUID() } });

function ingestEnv(env: Env): IngestEnv {
  return {
    googleClientId: env.GOOGLE_CLIENT_ID ?? "",
    googleClientSecret: env.GOOGLE_CLIENT_SECRET ?? "",
    llm: llmConfigFromEnv(env),
    fetchFn: fetch,
    now: () => new Date(),
    vapid: vapidFromEnv(env),
  };
}

async function guarded(name: string, req: Request, env: Env, run: () => Promise<Record<string, unknown>>) {
  if (!(await secretEquals(req.headers.get("x-cron-secret"), env.CRON_SECRET))) return unauthorized();
  const started = Date.now();
  const out = await run();
  // NFR-9: one summary line per run, counts only — never content
  console.log(JSON.stringify({ fn: name, ...out, ms: Date.now() - started }));
  return json(200, out);
}

export function handleIngestGmail(req: Request, db: Db, env: Env) {
  return guarded("ingest-gmail", req, env, async () => {
    const body = (await req.json().catch(() => ({}))) as { mode?: string };
    return { ...(await runGmail(db, ingestEnv(env), body.mode === "backfill" ? "backfill" : "poll")) };
  });
}

export function handleProcessLlmJobs(req: Request, db: Db, env: Env) {
  return guarded("process-llm-jobs", req, env, async () => ({ ...(await processLlmJobs(db, ingestEnv(env))) }));
}

export function handleMaintenance(req: Request, db: Db, env: Env) {
  return guarded("maintenance", req, env, async () => ({ ...(await maintenance(db, new Date())) }));
}

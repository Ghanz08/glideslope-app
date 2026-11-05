// In-process Postgres (PGlite) with a minimal stand-in for Supabase's auth schema, so migrations,
// RLS and RPCs can be tested without Docker. shortcut: no GoTrue/PostgREST; full-stack checks need `supabase start`.
import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const AUTH_STUB = `
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth;
create table auth.users (id uuid primary key, email text, raw_app_meta_data jsonb default '{}');
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
create function auth.uid() returns uuid language sql stable as $$ select nullif(auth.jwt() ->> 'sub', '')::uuid $$;
grant usage on schema auth, public to authenticated, service_role;
create schema vault;
create table vault.secrets (id uuid primary key default gen_random_uuid(), name text, secret text);
create view vault.decrypted_secrets as select id, name, secret as decrypted_secret from vault.secrets;
create function vault.create_secret(s text, n text default null, d text default null) returns uuid language sql as $$
  insert into vault.secrets (name, secret) values (n, s) returning id $$;
create function vault.update_secret(i uuid, s text) returns void language sql as $$ update vault.secrets set secret = s where id = i $$;
grant execute on all functions in schema auth to authenticated, service_role;
`;

export async function createDb() {
  const db = new PGlite();
  await db.exec(AUTH_STUB);
  const dir = path.resolve(__dirname, "../../supabase/migrations");
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    await db.exec(readFileSync(path.join(dir, f), "utf8"));
  }
  await db.exec(`grant all on all tables in schema public to authenticated, service_role;
    grant execute on all functions in schema public to authenticated, service_role;`);
  return db;
}

export type Db = Awaited<ReturnType<typeof createDb>>;

export async function addUser(db: Db, id: string, extra = false) {
  await db.query(`insert into auth.users (id, email, raw_app_meta_data) values ($1, $2, $3)`, [
    id,
    `${id.slice(0, 4)}@test.example`,
    JSON.stringify(extra ? { allow_extra_user: "true" } : {}),
  ]);
}

/** Run `fn` as an authenticated user at the given AAL inside one transaction. */
export async function asUser<T>(db: Db, uid: string, aal: "aal1" | "aal2", fn: (q: Db["query"]) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: uid, aal, role: "authenticated" })]);
    await tx.query(`set local role authenticated`);
    return fn(tx.query.bind(tx) as Db["query"]);
  });
}

import type { Db as IngestDb } from "../../src/lib/ingest/db";

/** Adapter: PGlite as the privileged SQL surface used by the ingest pipeline. */
export function ingestDb(db: Db): IngestDb {
  return {
    q: async (text, params) => (await db.query(text, params)).rows as never,
    tx: (fn) => db.transaction((tx) => fn(async (text, params) => (await tx.query(text, params)).rows as never)),
  };
}

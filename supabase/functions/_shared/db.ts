// postgres.js adapter for the shared pipeline. SUPABASE_DB_URL is provided to every Edge Function.
import postgres from "https://deno.land/x/postgresjs@v3.4.5/mod.js";

type Row = Record<string, unknown>;
type Q = (text: string, params?: unknown[]) => Promise<Row[]>;

const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { max: 2, prepare: false });

const wrap = (s: postgres.Sql | postgres.TransactionSql): Q => async (text, params = []) => (await s.unsafe(text, params as never[])) as unknown as Row[];

export const db = {
  q: wrap(sql),
  tx: <T>(fn: (q: Q) => Promise<T>) => sql.begin((t) => fn(wrap(t))) as Promise<T>,
};

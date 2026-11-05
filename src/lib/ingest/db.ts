// Minimal SQL surface shared by the Edge Functions (postgres.js), the local worker and tests (PGlite).
// Runs as a privileged role: every statement must scope by user. `asUser` also sets the JWT claims so
// column defaults (user_id = auth.uid()) and the RPCs behave exactly as for the owner.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Row = Record<string, any>;
export type Q = <T extends Row = Row>(text: string, params?: unknown[]) => Promise<T[]>;

export interface Db {
  q: Q;
  tx<T>(fn: (q: Q) => Promise<T>): Promise<T>;
}

export async function asUser<T>(db: Db, uid: string, fn: (q: Q) => Promise<T>): Promise<T> {
  return db.tx(async (q) => {
    await q(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: uid, aal: "aal2", role: "service_role" })]);
    return fn(q);
  });
}

/** Constant-time comparison that works in Node and Deno. */
export async function secretEquals(a: string | null | undefined, b: string | null | undefined): Promise<boolean> {
  if (!a || !b) return false;
  const enc = new TextEncoder();
  const [x, y] = await Promise.all([crypto.subtle.digest("SHA-256", enc.encode(a)), crypto.subtle.digest("SHA-256", enc.encode(b))]);
  const ax = new Uint8Array(x);
  const ay = new Uint8Array(y);
  let diff = 0;
  for (let i = 0; i < ax.length; i++) diff |= ax[i] ^ ay[i];
  return diff === 0;
}

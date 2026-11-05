import "server-only";
import { createServerClient } from "@supabase/ssr";
import { createClient as createJsClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

import { supabasePublishableKey, supabaseUrl as url } from "@/lib/env";

/** Cookie-based client: acts as the signed-in user, so RLS applies. */
export async function createClient() {
  const store = await cookies();
  return createServerClient(url(), supabasePublishableKey(), {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) store.set(name, value, { ...options, httpOnly: true, sameSite: "lax" });
        } catch {
          // called from a Server Component: the proxy refreshes the session instead
        }
      },
    },
  });
}

/** Service-role client. Server only; never reaches the browser (no NEXT_PUBLIC_ prefix). */
export function createAdminClient() {
  return createJsClient(url(), process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export type Supa = Awaited<ReturnType<typeof createClient>>;

import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { supabasePublishableKey, supabaseUrl } from "@/lib/env";

const PUBLIC = ["/masuk", "/api/ingest/webhook", "/api/cron/keepalive", "/offline", "/share-target"];

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const supabase = createServerClient(supabaseUrl(), supabasePublishableKey(), {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        for (const { name, value } of list) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of list) response.cookies.set(name, value, { ...options, httpOnly: true, sameSite: "lax" });
      },
    },
  });
  const { data } = await supabase.auth.getClaims();
  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC.some((p) => path === p || path.startsWith(`${p}/`));
  if (!data?.claims?.sub && !isPublic) {
    if (path.startsWith("/api/")) {
      return NextResponse.json({ error: { code: "TANPA_SESI", message: "Silakan masuk dulu.", request_id: crypto.randomUUID() } }, { status: 401 });
    }
    const url = request.nextUrl.clone();
    url.pathname = "/masuk";
    url.search = path === "/" ? "" : `?lanjut=${encodeURIComponent(path + request.nextUrl.search)}`;
    return NextResponse.redirect(url, 302);
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon-|manifest.webmanifest|sw.js).*)"],
};

export const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME || process.env.APP_NAME || "Glideslope";
export const appSlug = () => APP_NAME.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
export const pageTitle = (screen: string) => `${screen} · ${APP_NAME}`;

// Supabase is only reached from the server, so the Docker image reads these at runtime (SUPABASE_URL …);
// the NEXT_PUBLIC_ names stay as the local-dev fallback (Next inlines them at build time, so they cannot carry deploy values).
export const supabaseUrl = () => (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL)!;
export const supabasePublishableKey = () => (process.env.SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)!;
export const vapidPublicKey = () => process.env.VAPID_PUBLIC_KEY || process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || null;

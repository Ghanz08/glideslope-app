// Bundles the shared TypeScript (src/lib/core + src/lib/ingest) into one ESM file the Edge Functions import,
// so domain logic is written once (section 4.11).
import { build } from "esbuild";

await build({
  entryPoints: ["src/lib/ingest/edge.ts"],
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  outfile: "supabase/functions/_shared/core.js",
  logLevel: "info",
});

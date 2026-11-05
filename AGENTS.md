# AGENTS.md — Glideslope

Source of truth: `PRD.md`. Read it before changing behaviour; update it first when a decision changes.

## Commands
- `npm run dev` — Next.js dev server (needs `supabase start` + `.env.local`)
- `npm run build` — production build
- `npm run lint` — ESLint
- `npm run typecheck` — `tsc --noEmit` (strict)
- `npm test` — Vitest: pure domain logic (`src/lib/core`) and DB/RLS tests on PGlite (`tests/unit`)
- `npm run test:e2e` — Playwright + axe (needs the full local stack and a seeded owner)
- `npm run build:functions` — bundle `src/lib/core` + `src/lib/ingest` for the Edge Functions
- `npm run seed` — section 5.5 sample data (dev only)

## Layout
- `src/app` routes (App Router only; `src/proxy.ts` refreshes the session)
- `src/components` UI; `src/lib/core` pure logic shared with Edge Functions; `src/lib/server` server-only helpers
- `supabase/migrations` (never edit an applied migration — add a new one), `supabase/functions`, `tests/`

## Rules (PRD section 11)
- Always: run lint, typecheck and tests before declaring a phase done; tick only verified criteria.
- Money is an integer number of rupiah; time is stored UTC and shown WIB. No floats for money.
- Domain logic (runway, money parsing, split allocation, match scores, parsers) stays pure with unit tests; the clock is injectable (`APP_TODAY`, function args).
- Enforce access on the server and with RLS; every new table gets the `owner_aal2` policy (`user_id = auth.uid()` and aal2).
- Use the design tokens in `src/app/globals.css` only; no raw hex values elsewhere.
- Ask first (or, when nobody can answer, use the PRD Open Question default and record it): new dependencies outside section 1.8, schema changes to earlier phases, API contract changes, storing data not in section 5.
- Never: write tokens/keys/PIN/.env values to code, logs or commits; put `SUPABASE_SERVICE_ROLE_KEY` behind `NEXT_PUBLIC_`; send email/WhatsApp/push automatically (beyond section 8.2 push); auto-confirm LLM output; auto-link transfers unless the owner enabled it; touch Gmail beyond `gmail.readonly`; build non-goals; hard-delete owner data.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

#!/usr/bin/env bash
# Runs on the VPS from ~/glideslope/app (a checkout of this repo). Used by hand and by GitHub Actions.
#   TAG=<git sha> REGISTRY=ghcr.io/<owner>/glideslope deploy/deploy.sh   # pull CI images
#   deploy/deploy.sh --build                                             # build on the VPS instead
set -euo pipefail
cd "$(dirname "$0")"
SUPA=~/glideslope/supabase
psql_db() { docker exec -i supabase-db psql -v ON_ERROR_STOP=1 -q -U postgres -d postgres "$@"; }

# 1. migrations not yet applied (same bookkeeping table as the Supabase CLI)
psql_db -c "create schema if not exists supabase_migrations; create table if not exists supabase_migrations.schema_migrations (version text primary key, name text, statements text[]);"
for f in $(ls ../supabase/migrations/*.sql | sort); do
  base=$(basename "$f"); v=${base%%_*}; n=${base#*_}; n=${n%.sql}
  done_already=$(psql_db -At -c "select 1 from supabase_migrations.schema_migrations where version = '$v'")
  if [ -z "$done_already" ]; then
    echo "migrasi $base"
    psql_db < "$f"
    psql_db -c "insert into supabase_migrations.schema_migrations (version, name) values ('$v', '$n')"
  fi
done
# the LLM queue runs in the worker container (9router is on the host loopback, unreachable from Edge Functions)
psql_db -c "select cron.unschedule('process-llm-jobs') where exists (select 1 from cron.job where jobname = 'process-llm-jobs');" >/dev/null

# 2. images
if [ "${1:-}" = "--build" ]; then
  docker compose build
else
  docker compose pull web worker ocr
fi

# 3. Edge Functions (Gmail polling, maintenance) from the worker image, which carries the built core.js
img="${REGISTRY:-glideslope}/worker:${TAG:-latest}"
tmp=$(mktemp -d)
cid=$(docker create "$img")
docker cp "$cid:/app/supabase/functions/." "$tmp/"
docker rm "$cid" >/dev/null
for fn in ingest-gmail maintenance _shared; do
  rm -rf "$SUPA/volumes/functions/$fn"
  cp -r "$tmp/$fn" "$SUPA/volumes/functions/$fn"
done
rm -rf "$tmp"
(cd "$SUPA" && docker compose restart functions >/dev/null)

# 4. app
docker compose up -d --remove-orphans web worker ocr
if grep -q '^APP_DOMAIN=' .env 2>/dev/null; then docker compose --profile public up -d caddy; fi
docker image prune -f >/dev/null
echo "deploy selesai: ${TAG:-latest}"

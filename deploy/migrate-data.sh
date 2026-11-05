#!/usr/bin/env bash
# One-way copy of the owner's data: local Supabase (Supabase CLI) → VPS (self-hosted). Safe to re-run:
# the VPS side is emptied first. Run from the repo root on the laptop:  deploy/migrate-data.sh ghani-main
# Secrets (Gmail refresh token) go through a pipe straight into the VPS Vault and are never printed.
set -euo pipefail
HOST=${1:?usage: deploy/migrate-data.sh <ssh-host>}
LOCAL_DB=supabase_db_glideslope
remote_psql() { ssh -o BatchMode=yes "$HOST" "docker exec -i supabase-db psql -v ON_ERROR_STOP=1 -q -U supabase_admin -d postgres $*"; }

tables=$(docker exec "$LOCAL_DB" psql -U postgres -d postgres -At -c \
  "select string_agg(format('-t %I.%I', schemaname, tablename), ' ') from pg_tables where schemaname = 'public'")

echo "1/4 dump lokal"
dump=$(mktemp); trap 'rm -f "$dump"' EXIT
docker exec "$LOCAL_DB" pg_dump -U postgres -d postgres --data-only --no-owner --no-privileges \
  -t auth.users -t auth.identities -t auth.mfa_factors $tables > "$dump"

echo "2/4 kosongkan VPS"
remote_psql <<'SQL'
do $$ declare t text; begin
  for t in select format('%I.%I', schemaname, tablename) from pg_tables where schemaname = 'public' loop
    execute 'truncate ' || t || ' cascade';
  end loop;
end $$;
delete from vault.secrets where name like 'gmail_refresh_%';
delete from auth.mfa_factors; delete from auth.identities; delete from auth.sessions; delete from auth.users;
SQL

echo "3/4 muat data (pemicu dimatikan selama impor, termasuk kunci satu-pemilik)"
{ echo "set session_replication_role = replica;"; cat "$dump"; echo "set session_replication_role = origin;"; } | remote_psql >/dev/null

echo "4/4 token Gmail ke Vault VPS"
uid=$(docker exec "$LOCAL_DB" psql -U postgres -d postgres -At -c "select user_id from integrations where provider = 'gmail' and vault_secret_id is not null limit 1")
if [ -n "$uid" ]; then
  # the statement is built locally with format(%L) quoting and streamed; the token is never echoed
  docker exec "$LOCAL_DB" psql -U postgres -d postgres -At -c \
    "select format('select store_gmail_secret(%L, %L, %L);', user_id, read_gmail_secret(user_id), account_email) from integrations where user_id = '$uid' and provider = 'gmail'" \
    | ssh -o BatchMode=yes "$HOST" "docker exec -i supabase-db psql -q -v ON_ERROR_STOP=1 -U supabase_admin -d postgres >/dev/null"
fi

ssh -o BatchMode=yes "$HOST" "docker exec supabase-db psql -U supabase_admin -d postgres -At -c \"select 'pengguna ' || (select count(*) from auth.users) || ', faktor TOTP ' || (select count(*) from auth.mfa_factors) || ', transaksi ' || (select count(*) from public.transactions) || ', akun ' || (select count(*) from public.accounts) || ', gmail ' || coalesce((select status from public.integrations where provider = 'gmail'), '-')\""

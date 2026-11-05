-- Glideslope schema: every entity of PRD section 5, RLS (owner + aal2) on every table.
-- Money = bigint rupiah. Time = timestamptz (UTC). Display zone = Asia/Jakarta.


create schema if not exists private;

-- ---------------------------------------------------------------- helpers
create or replace function private.is_aal2() returns boolean
language sql stable as $$
  select coalesce((auth.jwt() ->> 'aal') = 'aal2', false)
$$;

create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

create or replace function public.wib_date(ts timestamptz) returns date
language sql immutable as $$ select (ts at time zone 'Asia/Jakarta')::date $$;

-- ---------------------------------------------------------------- single-owner signup lock (F-01.1)
-- After the first user exists, every new auth.users row is rejected. Only the service role can
-- set app_metadata, so `allow_extra_user` is used by the two-account RLS test and nothing else.
create or replace function private.reject_extra_users() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from auth.users)
     and coalesce(new.raw_app_meta_data ->> 'allow_extra_user', 'false') <> 'true' then
    raise exception 'Pendaftaran ditutup: aplikasi ini hanya untuk satu pemilik.';
  end if;
  return new;
end $$;

create trigger reject_extra_users before insert on auth.users
for each row execute function private.reject_extra_users();

-- ---------------------------------------------------------------- APP_SETTINGS
create table public.app_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  graduation_date date,
  emergency_reserve bigint not null default 0 check (emergency_reserve >= 0),
  burn_override bigint check (burn_override >= 0),
  large_amount_threshold bigint not null default 500000 check (large_amount_threshold between 10000 and 50000000),
  idle_timeout_minutes int not null default 5 check (idle_timeout_minutes in (1, 5, 15, 30)),
  pin_hash text,
  pin_salt text,
  pin_iterations int check (pin_iterations >= 210000),
  pin_failed_attempts int not null default 0,
  redaction_terms text[] not null default '{}',
  payment_instructions text check (char_length(payment_instructions) <= 500),
  llm_enabled boolean not null default true,
  auto_link_transfers boolean not null default false,
  onboarding_step int not null default 1 check (onboarding_step between 1 and 5),
  gmail_prompt_dismissed_until timestamptz,
  dismissed_banners jsonb not null default '{}',
  last_export_at timestamptz,
  push_prefs jsonb not null default '{"inbox": true, "gmail": true, "deposito": true}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- ACCOUNT
create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  kind text not null check (kind in ('bank', 'ewallet', 'cash')),
  last4 text check (last4 ~ '^[0-9]{4}$'),
  match_hints text[] not null default '{}',
  opening_balance bigint not null check (opening_balance between 0 and 10000000000),
  opening_date date not null,
  sort_order int not null default 0,
  is_system boolean not null default false,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index accounts_name_active_uq on public.accounts (user_id, lower(name)) where archived_at is null;
create index on public.accounts (user_id);

create table public.account_checkpoints (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  as_of date not null,
  balance bigint not null,
  source text not null default 'manual' check (source in ('manual', 'statement')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.account_checkpoints (user_id);
create index on public.account_checkpoints (account_id, as_of desc, created_at desc);

-- ---------------------------------------------------------------- CATEGORY / MERCHANT
create table public.categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 30),
  kind text not null check (kind in ('expense', 'income')),
  icon_key text not null,
  tone_key text not null,
  is_system boolean not null default false,
  sort_order int not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index categories_name_uq on public.categories (user_id, kind, lower(name));

create table public.merchants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 80),
  match_key text not null,
  default_category_id uuid references public.categories(id),
  default_one_off boolean not null default false,
  skip_review boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, match_key)
);

create table public.merchant_aliases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  alias_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, alias_key)
);

-- ---------------------------------------------------------------- TRANSACTION
create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  account_id uuid not null references public.accounts(id),
  direction text not null check (direction in ('in', 'out')),
  amount bigint not null check (amount > 0 and amount <= 999999999),
  occurred_at timestamptz not null,
  kind text not null check (kind in ('expense', 'income', 'transfer', 'fee', 'redemption', 'investment', 'repayment')),
  category_id uuid references public.categories(id),
  merchant_id uuid references public.merchants(id),
  merchant_raw text check (char_length(merchant_raw) <= 200),
  note text check (char_length(note) <= 500),
  status text not null check (status in ('needs_review', 'confirmed', 'auto_confirmed', 'ignored')),
  review_reason text check (review_reason in ('merchant_baru', 'kepercayaan_rendah', 'nominal_besar', 'llm_parsed',
    'hanya_nota', 'transfer_tidak_jelas', 'akun_tidak_dikenal', 'duplikat_diduga')),
  confidence numeric(3,2) check (confidence between 0 and 1),
  source text not null check (source in ('manual', 'email', 'receipt', 'webhook')),
  is_one_off boolean not null default false,
  dedupe_key text,
  -- idempotency key for manual creates (API-07/08 `client_id`)
  client_id uuid,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'needs_review' or review_reason is not null),
  check ((kind in ('expense', 'fee', 'investment') and direction = 'out')
      or (kind in ('income', 'redemption', 'repayment') and direction = 'in')
      or kind = 'transfer'),
  check (kind not in ('expense', 'income', 'fee') or status not in ('confirmed', 'auto_confirmed') or category_id is not null)
);
create index on public.transactions (user_id, occurred_at desc);
create index transactions_review_idx on public.transactions (user_id, status) where status = 'needs_review';
create unique index transactions_dedupe_uq on public.transactions (user_id, dedupe_key) where dedupe_key is not null;
create unique index transactions_client_uq on public.transactions (user_id, client_id) where client_id is not null;
create index on public.transactions (account_id, occurred_at);

create table public.transfer_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  out_transaction_id uuid not null unique references public.transactions(id),
  in_transaction_id uuid not null unique references public.transactions(id),
  fee_transaction_id uuid references public.transactions(id),
  created_by text not null check (created_by in ('manual', 'proposal', 'auto')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (out_transaction_id <> in_transaction_id)
);

-- ---------------------------------------------------------------- INGEST / EVIDENCE
create table public.email_sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  sender_address text not null check (sender_address = lower(sender_address) and position('@' in sender_address) > 1),
  label text not null check (char_length(label) between 1 and 40),
  parser_id text check (parser_id in ('mandiri', 'grab', 'shopee', 'google_play', 'esb', 'gojek')),
  enabled boolean not null default true,
  default_account_id uuid references public.accounts(id),
  verified_with_real_email boolean not null default false,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, sender_address)
);

create table public.ingest_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  channel text not null check (channel in ('gmail', 'webhook')),
  external_id text not null,
  source_id uuid references public.email_sources(id) on delete set null,
  sender text not null,
  subject text check (char_length(subject) <= 200),
  received_at timestamptz not null,
  parser_id text,
  parse_status text not null default 'pending'
    check (parse_status in ('pending', 'parsed', 'ignored', 'failed', 'needs_llm', 'unreadable')),
  parse_error text,
  parsed jsonb,
  raw_text_redacted text check (char_length(raw_text_redacted) <= 20000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, channel, external_id)
);
create index on public.ingest_events (user_id, parse_status);

create table public.integrations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  provider text not null check (provider = 'gmail'),
  vault_secret_id uuid,
  account_email text,
  status text not null default 'terputus' check (status in ('terhubung', 'perlu_hubungkan_ulang', 'terputus')),
  cursor_internal_date_ms bigint,
  backfill_state jsonb,
  last_polled_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider)
);

create table public.llm_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind text not null check (kind in ('parse_email', 'categorize', 'extract_receipt', 'quick_add')),
  ref_id uuid,
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'running', 'done', 'failed')),
  attempts int not null default 0 check (attempts between 0 and 5),
  next_attempt_at timestamptz not null default now(),
  result jsonb,
  error text,
  model_used text,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.llm_jobs (status, next_attempt_at);

create table public.receipts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  image_path text,
  status text not null default 'uploaded' check (status in ('uploaded', 'extracted', 'perlu_koreksi', 'confirmed', 'gagal')),
  merchant_name text,
  occurred_at timestamptz,
  subtotal bigint check (subtotal >= 0),
  service_charge bigint not null default 0 check (service_charge >= 0),
  tax_amount bigint not null default 0 check (tax_amount >= 0),
  tax_rate_pct numeric(5,2),
  discount bigint not null default 0 check (discount >= 0),
  rounding bigint not null default 0,
  total bigint check (total >= 0),
  payment_method text,
  validation_ok boolean not null default false,
  model_used text,
  linked_transaction_id uuid references public.transactions(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'confirmed' or total > 0)
);

create table public.receipt_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  receipt_id uuid not null references public.receipts(id) on delete cascade,
  position int not null check (position >= 1),
  name text not null check (char_length(name) between 1 and 120),
  quantity numeric(8,2) not null default 1 check (quantity > 0),
  unit_price bigint not null check (unit_price >= 0),
  line_total bigint not null check (line_total >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.transaction_evidence (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  transaction_id uuid not null references public.transactions(id) on delete cascade,
  role text not null check (role in ('email', 'receipt', 'webhook', 'manual')),
  ingest_event_id uuid references public.ingest_events(id),
  receipt_id uuid references public.receipts(id),
  parsed_amount bigint,
  match_score numeric(3,2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (transaction_id, ingest_event_id),
  unique (transaction_id, receipt_id)
);

-- ---------------------------------------------------------------- SPLIT / RECEIVABLE
create table public.split_bills (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  receipt_id uuid not null unique references public.receipts(id),
  transaction_id uuid unique references public.transactions(id),
  title text not null check (char_length(title) between 1 and 60),
  occurred_on date not null,
  total bigint not null check (total > 0),
  tax_base text not null default 'items_plus_service' check (tax_base in ('items_plus_service', 'items')),
  status text not null default 'draft' check (status in ('draft', 'shared', 'settled', 'cancelled')),
  shared_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.split_participants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  split_bill_id uuid not null references public.split_bills(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  phone_digits text check (phone_digits ~ '^[0-9]{8,15}$'),
  is_owner boolean not null default false,
  share_amount bigint not null default 0 check (share_amount >= 0),
  position int not null check (position >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index split_one_owner_uq on public.split_participants (split_bill_id) where is_owner;

create table public.split_assignments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  split_bill_id uuid not null references public.split_bills(id) on delete cascade,
  receipt_item_id uuid not null references public.receipt_items(id) on delete cascade,
  participant_id uuid not null references public.split_participants(id) on delete cascade,
  weight numeric(6,2) not null default 1 check (weight > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (receipt_item_id, participant_id)
);

create table public.receivables (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  split_participant_id uuid not null unique references public.split_participants(id),
  person_name text not null check (char_length(person_name) between 1 and 40),
  amount bigint not null check (amount > 0),
  remaining bigint not null,
  status text not null default 'open' check (status in ('open', 'partially_paid', 'settled', 'written_off')),
  settled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (remaining between 0 and amount)
);

create table public.receivable_payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  receivable_id uuid not null references public.receivables(id),
  transaction_id uuid not null unique references public.transactions(id),
  amount bigint not null check (amount > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.match_proposals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  type text not null check (type in ('transfer', 'repayment', 'receipt_link', 'duplicate_suspect')),
  transaction_id uuid not null references public.transactions(id),
  other_transaction_id uuid references public.transactions(id),
  receipt_id uuid references public.receipts(id),
  receivable_id uuid references public.receivables(id),
  score numeric(3,2) not null check (score between 0 and 1),
  fee_amount bigint not null default 0,
  status text not null default 'open' check (status in ('open', 'accepted', 'rejected', 'closed')),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index match_proposals_pair_uq on public.match_proposals
  (type, transaction_id, coalesce(other_transaction_id, receipt_id, receivable_id));

-- ---------------------------------------------------------------- ASSET / PLAN / SUBSCRIPTION / PUSH
create table public.assets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  type text not null check (type in ('deposit', 'money_market_fund', 'equity_fund', 'gold', 'other')),
  quantity numeric(18,4) not null check (quantity >= 0),
  cost_basis bigint check (cost_basis >= 0),
  maturity_date date,
  interest_rate_pa numeric(5,2) check (interest_rate_pa between 0 and 100),
  destination_account_id uuid references public.accounts(id),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (type <> 'deposit' or maturity_date is not null)
);

create table public.asset_prices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  asset_id uuid not null references public.assets(id) on delete cascade,
  as_of date not null,
  unit_price numeric(18,4) not null check (unit_price > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (asset_id, as_of)
);

create table public.asset_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  asset_id uuid not null references public.assets(id),
  kind text not null check (kind in ('purchase', 'redemption', 'adjustment')),
  occurred_on date not null,
  quantity_delta numeric(18,4) not null,
  amount bigint not null check (amount >= 0),
  transaction_id uuid unique references public.transactions(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((kind = 'purchase' and quantity_delta > 0) or (kind = 'redemption' and quantity_delta < 0) or kind = 'adjustment')
);

create table public.planned_expenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  label text not null check (char_length(label) between 1 and 40),
  amount bigint not null check (amount > 0),
  due_on date not null,
  repeat_months int check (repeat_months between 1 and 12),
  repeat_until date,
  category_id uuid references public.categories(id),
  paid_occurrences date[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  merchant_id uuid not null references public.merchants(id),
  period text not null check (period in ('monthly', 'yearly')),
  avg_amount bigint not null check (avg_amount > 0),
  last_seen_on date not null,
  next_expected_on date not null,
  status text not null default 'suggested' check (status in ('suggested', 'active', 'stopped', 'dismissed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, merchant_id)
);

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  last_success_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Rate-limit counters (login, PIN, webhook, export, receipt upload). Service role only.
create table private.rate_limits (
  key text primary key,
  window_start timestamptz not null,
  count int not null
);

-- ---------------------------------------------------------------- RLS + updated_at on every public table
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy owner_aal2 on public.%I for all to authenticated
         using (user_id = (select auth.uid()) and (select private.is_aal2()))
         with check (user_id = (select auth.uid()) and (select private.is_aal2()))', t);
    execute format('create trigger set_updated_at before update on public.%I
                    for each row execute function public.set_updated_at()', t);
  end loop;
end $$;

grant usage on schema private to authenticated, service_role;
grant execute on function private.is_aal2() to authenticated, service_role;

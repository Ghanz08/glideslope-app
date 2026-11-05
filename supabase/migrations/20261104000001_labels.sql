-- F-08.4 Label: cross-category tags for events/projects ("Umroh 2026"), optional target, optional auto one-off.
create table public.labels (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  auto_one_off boolean not null default false,
  target_amount bigint check (target_amount between 1 and 999999999999),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index labels_name_uq on public.labels (user_id, lower(name)) where archived_at is null;

create table public.transaction_labels (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  transaction_id uuid not null references public.transactions(id) on delete cascade,
  label_id uuid not null references public.labels(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (transaction_id, label_id)
);
create index transaction_labels_label_idx on public.transaction_labels (label_id);

do $$
declare t text;
begin
  foreach t in array array['labels', 'transaction_labels'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy owner_aal2 on public.%I for all to authenticated
         using (user_id = (select auth.uid()) and (select private.is_aal2()))
         with check (user_id = (select auth.uid()) and (select private.is_aal2()))', t);
    execute format('create trigger set_updated_at before update on public.%I
                    for each row execute function public.set_updated_at()', t);
  end loop;
end $$;

-- a link may only join the owner's own transaction and label (RLS hides other users' rows, so exists() fails for them)
drop policy owner_aal2 on public.transaction_labels;
create policy owner_aal2 on public.transaction_labels for all to authenticated
  using (user_id = (select auth.uid()) and (select private.is_aal2()))
  with check (
    user_id = (select auth.uid()) and (select private.is_aal2())
    and exists (select 1 from public.transactions t where t.id = transaction_id)
    and exists (select 1 from public.labels l where l.id = label_id)
  );

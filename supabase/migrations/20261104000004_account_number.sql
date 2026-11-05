-- F-02.1: full account / phone number, shown only when the owner unhides it (privacy toggle). last4 stays the
-- matching key and is derived from the number when one is given. Owner's decision 2026-11-04.
alter table public.accounts add column number text check (number ~ '^[0-9]{6,20}$');
alter table public.accounts add constraint accounts_last4_matches_number check (number is null or last4 = right(number, 4));

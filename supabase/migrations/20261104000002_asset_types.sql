-- F-07.1 wider asset types: bonds & SBN (ORI, SR, SBR, ST, FR, corporate) with a monthly coupon day,
-- fixed-income funds, stocks and crypto. Bonds, like deposits, need a maturity date.
alter table public.assets drop constraint assets_type_check;
alter table public.assets add constraint assets_type_check
  check (type in ('deposit', 'money_market_fund', 'fixed_income_fund', 'equity_fund', 'bond', 'stock', 'gold', 'crypto', 'other'));
alter table public.assets drop constraint assets_check;
alter table public.assets add constraint assets_check check (type not in ('deposit', 'bond') or maturity_date is not null);
alter table public.assets add column coupon_day smallint check (coupon_day between 1 and 31);

-- sebs.cashflow — Plaid connections
-- Access tokens live here, server-side only. The browser never sees them:
-- the anon key cannot read plaid_items because no policy grants it.

create table if not exists plaid_items (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  item_id        text not null unique,
  access_token   text not null,
  institution_id text,
  institution    text,
  cursor         text,                    -- transactions/sync pagination
  status         text not null default 'active',
  last_synced_at timestamptz,
  last_error     text,
  created_at     timestamptz not null default now()
);

create table if not exists plaid_accounts (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  item_id          text not null references plaid_items(item_id) on delete cascade,
  account_id       text not null unique,
  name             text,
  official_name    text,
  mask             text,
  type             text,                  -- depository | credit | investment
  subtype          text,                  -- checking | savings | credit card | 401k | hsa
  current_balance  numeric(14,2),
  available_balance numeric(14,2),
  limit_amount     numeric(14,2),
  -- how this maps onto the cashflow model
  mapping_kind     text check (mapping_kind in ('checking','card','asset','ignore')),
  mapping_ref      text,                  -- card id / asset id inside the cashflow doc
  balance_as_of    timestamptz,
  created_at       timestamptz not null default now()
);

create table if not exists plaid_transactions (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  account_id     text not null,
  transaction_id text not null unique,
  date           date not null,
  amount         numeric(14,2) not null,  -- Plaid sign: positive = money out
  name           text,
  merchant_name  text,
  category       text,
  pending        boolean not null default false,
  -- reconciliation against the cashflow model
  matched_key    text,                    -- chargeKey of the fixed charge it settles
  matched_at     timestamptz,
  created_at     timestamptz not null default now()
);

create index if not exists idx_plaid_tx_user_date on plaid_transactions (user_id, date desc);
create index if not exists idx_plaid_tx_account on plaid_transactions (account_id, date desc);

alter table plaid_items        enable row level security;
alter table plaid_accounts     enable row level security;
alter table plaid_transactions enable row level security;

-- Accounts and transactions are readable by their owner.
drop policy if exists "Users read their plaid accounts" on plaid_accounts;
create policy "Users read their plaid accounts" on plaid_accounts
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Users read their plaid transactions" on plaid_transactions;
create policy "Users read their plaid transactions" on plaid_transactions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- plaid_items deliberately has NO policy: only the service key reaches it,
-- so access tokens are unreachable from the browser.

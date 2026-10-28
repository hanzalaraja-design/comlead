-- Personal keys for connecting Highfy Tasks to Claude (the MCP connector).
-- Only a hash of each key is stored; the key itself is shown once, when made.
-- Claude then acts as that person, with exactly their permissions.

create table if not exists public.api_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  name text not null default 'Claude' check (length(trim(name)) between 1 and 60),
  -- The first few characters, so people can tell their keys apart.
  prefix text not null,
  key_hash text not null unique,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
create index if not exists api_keys_user_idx on public.api_keys (user_id);

alter table public.api_keys enable row level security;
revoke all on public.api_keys from anon, authenticated;
grant select, insert on public.api_keys to authenticated;
grant update (revoked_at) on public.api_keys to authenticated;

drop policy if exists api_keys_select on public.api_keys;
create policy api_keys_select on public.api_keys
  for select to authenticated
  using (user_id = auth.uid() and public.is_active_user());

drop policy if exists api_keys_insert on public.api_keys;
create policy api_keys_insert on public.api_keys
  for insert to authenticated
  with check (user_id = auth.uid() and public.is_active_user());

-- Revoke only; a revoked key stays revoked.
drop policy if exists api_keys_revoke on public.api_keys;
create policy api_keys_revoke on public.api_keys
  for update to authenticated
  using (user_id = auth.uid() and revoked_at is null)
  with check (user_id = auth.uid() and revoked_at is not null);

notify pgrst, 'reload schema';

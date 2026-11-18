-- Highfy Tasks: create and update tasks by WhatsApp message or voice note.
-- Only numbers linked to a person can do anything; everything then runs as
-- that person, with their own permissions.

-- A person's WhatsApp number, linked by sending "link 123456" from it.
create table public.whatsapp_links (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  phone text not null unique check (phone ~ '^[0-9]{8,15}$'),  -- digits only, with country code
  linked_at timestamptz not null default now()
);
alter table public.whatsapp_links enable row level security;
revoke all on public.whatsapp_links from anon, authenticated;
grant select, delete on public.whatsapp_links to authenticated;
create policy whatsapp_links_own on public.whatsapp_links for all to authenticated using (user_id = auth.uid());

-- One-time codes shown in My settings; valid for 15 minutes.
create table public.whatsapp_link_codes (
  user_id uuid primary key references public.profiles (id) on delete cascade default auth.uid(),
  code text not null unique check (code ~ '^[0-9]{6}$'),
  expires_at timestamptz not null default now() + interval '15 minutes'
);
alter table public.whatsapp_link_codes enable row level security;
revoke all on public.whatsapp_link_codes from anon, authenticated;
grant select, insert, update, delete on public.whatsapp_link_codes to authenticated;
create policy whatsapp_link_codes_own on public.whatsapp_link_codes for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Every message in and every reply out: stops WhatsApp's retries being handled twice,
-- and gives the assistant the recent conversation (so "make it Monday" works).
create table public.whatsapp_messages (
  id uuid primary key default gen_random_uuid(),
  wa_id text unique,                -- WhatsApp's message id (inbound)
  phone text not null,
  user_id uuid references public.profiles (id) on delete set null,
  direction text not null check (direction in ('in', 'out')),
  kind text not null default 'text', -- text, audio, other
  body text,
  created_at timestamptz not null default now()
);
create index whatsapp_messages_phone_time_idx on public.whatsapp_messages (phone, created_at desc);
alter table public.whatsapp_messages enable row level security;
revoke all on public.whatsapp_messages from anon, authenticated;
grant select on public.whatsapp_messages to authenticated;
create policy whatsapp_messages_own on public.whatsapp_messages for select to authenticated using (user_id = auth.uid());

notify pgrst, 'reload schema';

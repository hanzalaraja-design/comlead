-- WhatsApp: messages sent in quick succession are handled together, once.
-- Each incoming message is marked when it's taken for handling, so two
-- servers never handle the same message, and the assistant only sees what
-- was already handled as "earlier conversation".

alter table public.whatsapp_messages add column if not exists handled_at timestamptz;

-- Everything before this change was already handled.
update public.whatsapp_messages set handled_at = created_at where handled_at is null and direction = 'in';

create index if not exists whatsapp_messages_waiting_idx on public.whatsapp_messages (phone, created_at) where direction = 'in' and handled_at is null;

notify pgrst, 'reload schema';

create extension if not exists pgcrypto;

create table if not exists public.sms_campaigns (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by_email text,
  name text,
  sender_id text not null default 'fluxsms',
  message text not null,
  segment jsonb not null default '{}'::jsonb,
  status text not null default 'draft',
  target_count integer not null default 0,
  sent_count integer not null default 0,
  delivered_count integer not null default 0,
  failed_count integer not null default 0,
  last_dispatch_at timestamptz,
  last_refresh_at timestamptz
);

create index if not exists sms_campaigns_created_at_idx on public.sms_campaigns (created_at desc);

create table if not exists public.sms_messages (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  campaign_id uuid not null references public.sms_campaigns(id) on delete cascade,
  phone text not null,
  phone_normalized text not null,
  tx_id text,
  tx_status text,
  amount numeric,
  status text not null default 'queued',
  flux_message_id text,
  send_response jsonb,
  delivery_status_code integer,
  delivery_status_text text,
  delivery_response jsonb,
  last_checked_at timestamptz
);

create index if not exists sms_messages_campaign_id_idx on public.sms_messages (campaign_id);
create index if not exists sms_messages_campaign_status_idx on public.sms_messages (campaign_id, status);
create index if not exists sms_messages_flux_message_id_idx on public.sms_messages (flux_message_id);
create unique index if not exists sms_messages_campaign_phone_unique on public.sms_messages (campaign_id, phone_normalized);

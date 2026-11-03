-- PutkiAjo: CRM (pipelines, deals, contacts, notes) and IMAP/SMTP mail sync.

create table public.crm_pipelines (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id)
);

create table public.crm_stages (
  id uuid primary key default gen_random_uuid(),
  pipeline_id uuid not null,
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  position integer not null default 0,
  probability integer not null default 100 check (probability between 0 and 100),
  rotting_days integer check (rotting_days is null or rotting_days > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id),
  unique (id, pipeline_id, owner_id),
  foreign key (pipeline_id, owner_id)
    references public.crm_pipelines(id, owner_id) on delete cascade
);

create table public.crm_organizations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 200),
  address text not null default '',
  website text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id)
);

create table public.crm_persons (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  organization_id uuid,
  name text not null check (char_length(name) between 1 and 200),
  -- [{ "value": "lowercased@address", "label": "work", "primary": true }]
  emails jsonb not null default '[]'::jsonb check (jsonb_typeof(emails) = 'array'),
  phones jsonb not null default '[]'::jsonb check (jsonb_typeof(phones) = 'array'),
  label text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id),
  foreign key (organization_id, owner_id)
    references public.crm_organizations(id, owner_id)
    on delete set null (organization_id)
);

create table public.crm_deals (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  pipeline_id uuid not null,
  stage_id uuid not null,
  person_id uuid,
  organization_id uuid,
  title text not null check (char_length(title) between 1 and 240),
  value numeric(14, 2) not null default 0 check (value >= 0),
  currency text not null default 'EUR' check (char_length(currency) = 3),
  status text not null default 'open' check (status in ('open', 'won', 'lost')),
  lost_reason text not null default '',
  expected_close_date date,
  won_at timestamptz,
  lost_at timestamptz,
  stage_changed_at timestamptz not null default now(),
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id),
  foreign key (pipeline_id, owner_id)
    references public.crm_pipelines(id, owner_id) on delete cascade,
  foreign key (stage_id, pipeline_id, owner_id)
    references public.crm_stages(id, pipeline_id, owner_id),
  foreign key (person_id, owner_id)
    references public.crm_persons(id, owner_id) on delete set null (person_id),
  foreign key (organization_id, owner_id)
    references public.crm_organizations(id, owner_id)
    on delete set null (organization_id)
);

create table public.crm_notes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  deal_id uuid,
  person_id uuid,
  organization_id uuid,
  body text not null check (char_length(body) between 1 and 20000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (num_nonnulls(deal_id, person_id, organization_id) = 1),
  foreign key (deal_id, owner_id)
    references public.crm_deals(id, owner_id) on delete cascade,
  foreign key (person_id, owner_id)
    references public.crm_persons(id, owner_id) on delete cascade,
  foreign key (organization_id, owner_id)
    references public.crm_organizations(id, owner_id) on delete cascade
);

create table public.mail_accounts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  email text not null check (char_length(email) between 3 and 320),
  display_name text not null default '',
  status text not null default 'ok' check (status in ('ok', 'error', 'syncing')),
  last_error text,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id),
  unique (owner_id, email)
);

-- Server-only: readable through the secret key, never by browser sessions.
create table public.mail_account_secrets (
  account_id uuid primary key references public.mail_accounts(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  credentials text not null,
  imap_host text not null,
  imap_port integer not null check (imap_port between 1 and 65535),
  imap_secure boolean not null default true,
  smtp_host text not null,
  smtp_port integer not null check (smtp_port between 1 and 65535),
  smtp_secure boolean not null default true,
  folders jsonb not null default '{}'::jsonb,
  sync_state jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.email_threads (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid not null,
  provider_thread_id text not null,
  subject text not null default '',
  snippet text not null default '',
  participants jsonb not null default '[]'::jsonb,
  last_message_at timestamptz not null default now(),
  message_count integer not null default 0,
  is_unread boolean not null default false,
  folder text not null default 'inbox' check (folder in ('inbox', 'sent', 'archive')),
  deal_id uuid,
  person_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id),
  unique (account_id, provider_thread_id),
  foreign key (account_id, owner_id)
    references public.mail_accounts(id, owner_id) on delete cascade,
  foreign key (deal_id, owner_id)
    references public.crm_deals(id, owner_id) on delete set null (deal_id),
  foreign key (person_id, owner_id)
    references public.crm_persons(id, owner_id) on delete set null (person_id)
);

create table public.email_messages (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid not null,
  thread_id uuid not null,
  -- "<folder>:<uidvalidity>:<uid>" of the copy we last saw on the server.
  provider_message_id text not null,
  folder text not null check (folder in ('inbox', 'sent', 'archive')),
  uid bigint not null,
  uidvalidity bigint not null,
  message_id_header text not null,
  in_reply_to text,
  "references" text[] not null default '{}',
  from_address jsonb not null default '{}'::jsonb,
  to_addresses jsonb not null default '[]'::jsonb,
  cc_addresses jsonb not null default '[]'::jsonb,
  subject text not null default '',
  body_html text,
  body_text text not null default '',
  attachments jsonb not null default '[]'::jsonb,
  sent_at timestamptz not null default now(),
  is_outbound boolean not null default false,
  is_seen boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, message_id_header),
  foreign key (account_id, owner_id)
    references public.mail_accounts(id, owner_id) on delete cascade,
  foreign key (thread_id, owner_id)
    references public.email_threads(id, owner_id) on delete cascade
);

create index crm_pipelines_owner_position_idx on public.crm_pipelines(owner_id, position);
create index crm_stages_pipeline_position_idx on public.crm_stages(pipeline_id, position);
create index crm_stages_pipeline_owner_idx on public.crm_stages(pipeline_id, owner_id);
create index crm_organizations_owner_name_idx on public.crm_organizations(owner_id, name);
create index crm_persons_owner_name_idx on public.crm_persons(owner_id, name);
create index crm_persons_org_owner_idx on public.crm_persons(organization_id, owner_id);
create index crm_persons_emails_idx on public.crm_persons using gin (emails jsonb_path_ops);
create index crm_deals_pipeline_owner_idx on public.crm_deals(pipeline_id, owner_id);
create index crm_deals_stage_position_idx on public.crm_deals(stage_id, position);
create index crm_deals_stage_pipeline_owner_idx on public.crm_deals(stage_id, pipeline_id, owner_id);
create index crm_deals_person_owner_idx on public.crm_deals(person_id, owner_id);
create index crm_deals_org_owner_idx on public.crm_deals(organization_id, owner_id);
create index crm_notes_deal_owner_idx on public.crm_notes(deal_id, owner_id);
create index crm_notes_person_owner_idx on public.crm_notes(person_id, owner_id);
create index crm_notes_org_owner_idx on public.crm_notes(organization_id, owner_id);
create index mail_account_secrets_owner_idx on public.mail_account_secrets(owner_id);
create index email_threads_account_owner_idx on public.email_threads(account_id, owner_id);
create index email_threads_owner_last_idx on public.email_threads(owner_id, last_message_at desc);
create index email_threads_deal_owner_idx on public.email_threads(deal_id, owner_id);
create index email_threads_person_owner_idx on public.email_threads(person_id, owner_id);
create index email_messages_thread_sent_idx on public.email_messages(thread_id, sent_at);
create index email_messages_thread_owner_idx on public.email_messages(thread_id, owner_id);
create index email_messages_account_owner_idx on public.email_messages(account_id, owner_id);
create index email_messages_account_folder_uid_idx on public.email_messages(account_id, folder, uid);
create index email_messages_owner_idx on public.email_messages(owner_id);

alter table public.crm_pipelines enable row level security;
alter table public.crm_stages enable row level security;
alter table public.crm_organizations enable row level security;
alter table public.crm_persons enable row level security;
alter table public.crm_deals enable row level security;
alter table public.crm_notes enable row level security;
alter table public.mail_accounts enable row level security;
alter table public.mail_account_secrets enable row level security;
alter table public.email_threads enable row level security;
alter table public.email_messages enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array[
    'crm_pipelines', 'crm_stages', 'crm_organizations',
    'crm_persons', 'crm_deals', 'crm_notes'
  ] loop
    execute format(
      'create policy "Owners can read %1$s" on public.%1$I for select to authenticated using ((select auth.uid()) = owner_id)', t);
    execute format(
      'create policy "Owners can create %1$s" on public.%1$I for insert to authenticated with check ((select auth.uid()) = owner_id)', t);
    execute format(
      'create policy "Owners can update %1$s" on public.%1$I for update to authenticated using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id)', t);
    execute format(
      'create policy "Owners can delete %1$s" on public.%1$I for delete to authenticated using ((select auth.uid()) = owner_id)', t);
  end loop;
end $$;

-- Mail rows are written by the server (secret key); browsers read them and
-- may link threads to deals/persons.
create policy "Owners can read mail accounts"
  on public.mail_accounts for select to authenticated
  using ((select auth.uid()) = owner_id);
create policy "Owners can delete mail accounts"
  on public.mail_accounts for delete to authenticated
  using ((select auth.uid()) = owner_id);

create policy "Owners can read email threads"
  on public.email_threads for select to authenticated
  using ((select auth.uid()) = owner_id);
create policy "Owners can update email threads"
  on public.email_threads for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

create policy "Owners can read email messages"
  on public.email_messages for select to authenticated
  using ((select auth.uid()) = owner_id);

revoke all on
  public.crm_pipelines, public.crm_stages, public.crm_organizations,
  public.crm_persons, public.crm_deals, public.crm_notes,
  public.mail_accounts, public.mail_account_secrets,
  public.email_threads, public.email_messages
from anon, authenticated;

grant select, insert, update, delete on
  public.crm_pipelines, public.crm_stages, public.crm_organizations,
  public.crm_persons, public.crm_deals, public.crm_notes
to authenticated;
grant select, delete on public.mail_accounts to authenticated;
grant select, update (deal_id, person_id) on public.email_threads to authenticated;
grant select on public.email_messages to authenticated;

create function public.crm_ensure_default_pipeline()
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  pipeline uuid;
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;

  perform pg_advisory_xact_lock(hashtext('crm_default_pipeline:' || uid::text));

  select id into pipeline
  from public.crm_pipelines
  where owner_id = uid
  order by position, created_at
  limit 1;

  if pipeline is not null then
    return pipeline;
  end if;

  insert into public.crm_pipelines (owner_id, name, position)
  values (uid, 'Pipeline', 0)
  returning id into pipeline;

  insert into public.crm_stages (pipeline_id, owner_id, name, position, probability)
  values
    (pipeline, uid, 'Qualified', 0, 10),
    (pipeline, uid, 'Contact made', 1, 20),
    (pipeline, uid, 'Demo scheduled', 2, 40),
    (pipeline, uid, 'Proposal made', 3, 60),
    (pipeline, uid, 'Negotiations started', 4, 80);

  return pipeline;
end;
$$;

revoke execute on function public.crm_ensure_default_pipeline() from public, anon;
grant execute on function public.crm_ensure_default_pipeline() to authenticated;

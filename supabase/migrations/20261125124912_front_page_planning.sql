-- Front page (Etusivu): one source of truth for status, planning fields,
-- time blocks and Google Calendar storage.
--
-- Status / severity / due date live in items.column_values. Each board marks
-- its columns with settings.role and its Status options with option.state:
--   board_columns.settings.role   : 'status' | 'severity' | 'due_date'
--   settings.options[].state      : 'done' | 'in_progress'   (status column only)

-- ---------------------------------------------------------------------------
-- 1. Column roles and option states (backfill)
-- ---------------------------------------------------------------------------

update public.board_columns
set settings = jsonb_set(
      settings || '{"role":"status"}'::jsonb,
      '{options}',
      coalesce((
        select jsonb_agg(
          case
            when opt->>'id' = 'done' or lower(opt->>'label') = 'done'
              then opt || '{"state":"done"}'::jsonb
            when opt->>'id' = 'working' or lower(opt->>'label') = 'working on it'
              then opt || '{"state":"in_progress"}'::jsonb
            else opt
          end
          order by ord)
        from jsonb_array_elements(settings->'options') with ordinality as o(opt, ord)
      ), '[]'::jsonb)
    ),
    updated_at = now()
where type = 'label' and title = 'Status' and not (settings ? 'role');

update public.board_columns
set settings = settings || '{"role":"severity"}'::jsonb, updated_at = now()
where type = 'label' and title = 'Severity' and not (settings ? 'role');

update public.board_columns
set settings = settings || '{"role":"due_date"}'::jsonb, updated_at = now()
where type = 'date' and title = 'Due date' and not (settings ? 'role');

-- ---------------------------------------------------------------------------
-- 2. Planning fields on items
-- ---------------------------------------------------------------------------

alter table public.items
  add column planned_week date,
  add column planned_day date,
  add column completed_at timestamptz,
  add constraint items_planned_week_is_monday
    check (planned_week is null or extract(isodow from planned_week) = 1),
  add constraint items_id_owner_key unique (id, owner_id);

create index items_owner_planned_week_idx on public.items(owner_id, planned_week);
create index items_owner_planned_day_idx on public.items(owner_id, planned_day);
create index items_owner_completed_at_idx on public.items(owner_id, completed_at);

-- True when the item's Status column value is an option with state = 'done'.
create function public.item_is_done(p_board_id uuid, p_column_values jsonb)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1
    from public.board_columns c,
         jsonb_array_elements(coalesce(c.settings->'options', '[]'::jsonb)) opt
    where c.board_id = p_board_id
      and c.settings->>'role' = 'status'
      and opt->>'state' = 'done'
      and opt->>'id' = p_column_values->>(c.id::text)
  );
$$;

-- Keeps planned_week in step with planned_day and sets/clears completed_at,
-- whoever writes the row (board UI, browser automations, MCP).
create function public.items_planning_trigger()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  is_done boolean;
begin
  if new.planned_day is not null then
    new.planned_week := (date_trunc('week', new.planned_day::timestamp))::date;
  end if;

  if tg_op = 'INSERT'
     or new.column_values is distinct from old.column_values
     or new.board_id is distinct from old.board_id then
    is_done := public.item_is_done(new.board_id, new.column_values);
    if is_done and new.completed_at is null then
      new.completed_at := now();
    elsif not is_done then
      new.completed_at := null;
    end if;
  end if;

  return new;
end;
$$;

create trigger items_planning
  before insert or update on public.items
  for each row execute function public.items_planning_trigger();

-- Backfill completed_at for items that are already done.
update public.items i
set completed_at = i.updated_at
where public.item_is_done(i.board_id, i.column_values) and i.completed_at is null;

-- ---------------------------------------------------------------------------
-- 3. Time blocks
-- ---------------------------------------------------------------------------

create table public.time_blocks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  title text not null default '' check (char_length(title) <= 240),
  kind text not null default 'focus'
    check (kind in ('focus', 'free_coding', 'admin', 'other')),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  board_id uuid,
  item_id uuid,
  note_before text not null default '',
  note_after text not null default '',
  done_at timestamptz,
  google_calendar_id text,
  google_event_id text,
  google_etag text,
  sync_status text not null default 'local'
    check (sync_status in ('local', 'synced', 'pending', 'error')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at),
  unique (owner_id, google_event_id),
  foreign key (board_id, owner_id)
    references public.boards(id, owner_id) on delete set null (board_id),
  foreign key (item_id, owner_id)
    references public.items(id, owner_id) on delete set null (item_id)
);

create index time_blocks_owner_starts_idx on public.time_blocks(owner_id, starts_at);
create index time_blocks_board_owner_idx on public.time_blocks(board_id, owner_id);
create index time_blocks_item_owner_idx on public.time_blocks(item_id, owner_id);
create index time_blocks_owner_sync_idx on public.time_blocks(owner_id, sync_status)
  where sync_status in ('pending', 'error');

alter table public.time_blocks enable row level security;

create policy "Owners can read time blocks"
  on public.time_blocks for select to authenticated
  using ((select auth.uid()) = owner_id);
create policy "Owners can create time blocks"
  on public.time_blocks for insert to authenticated
  with check ((select auth.uid()) = owner_id);
create policy "Owners can update time blocks"
  on public.time_blocks for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);
create policy "Owners can delete time blocks"
  on public.time_blocks for delete to authenticated
  using ((select auth.uid()) = owner_id);

revoke all on public.time_blocks from anon;
grant select, insert, update, delete on public.time_blocks to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Google Calendar accounts, secrets and event cache
-- ---------------------------------------------------------------------------

create table public.calendar_accounts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references auth.users(id) on delete cascade,
  email text not null default '',
  status text not null default 'ok' check (status in ('ok', 'error', 'revoked')),
  last_error text,
  last_synced_at timestamptz,
  write_calendar_id text,
  read_calendar_ids jsonb not null default '[]'::jsonb,
  available_calendars jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id)
);

create table public.calendar_account_secrets (
  account_id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  refresh_token text not null,           -- encrypted (src/lib/mail/crypto.ts format)
  sync_tokens jsonb not null default '{}'::jsonb,
  watch_channels jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (account_id, owner_id)
    references public.calendar_accounts(id, owner_id) on delete cascade
);

create index calendar_account_secrets_owner_idx on public.calendar_account_secrets(owner_id);

create table public.calendar_events_cache (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  calendar_id text not null,
  google_event_id text not null,
  title text not null default '',
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  all_day boolean not null default false,
  updated_at timestamptz not null default now(),
  unique (owner_id, calendar_id, google_event_id)
);

create index calendar_events_cache_owner_range_idx
  on public.calendar_events_cache(owner_id, starts_at, ends_at);

alter table public.calendar_accounts enable row level security;
alter table public.calendar_account_secrets enable row level security;
alter table public.calendar_events_cache enable row level security;

create policy "Owners can read calendar accounts"
  on public.calendar_accounts for select to authenticated
  using ((select auth.uid()) = owner_id);
create policy "Owners can update calendar accounts"
  on public.calendar_accounts for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

create policy "Owners can read cached calendar events"
  on public.calendar_events_cache for select to authenticated
  using ((select auth.uid()) = owner_id);

-- calendar_account_secrets: no policies; only the service role reads it.

revoke all on
  public.calendar_accounts, public.calendar_account_secrets, public.calendar_events_cache
from anon, authenticated;
grant select on public.calendar_accounts to authenticated;
grant update (read_calendar_ids) on public.calendar_accounts to authenticated;
grant select on public.calendar_events_cache to authenticated;

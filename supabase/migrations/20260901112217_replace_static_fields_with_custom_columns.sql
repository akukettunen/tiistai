drop index if exists public.items_owner_severity_idx;
drop index if exists public.items_labels_idx;

alter table public.items
  drop column if exists severity,
  drop column if exists category,
  drop column if exists labels,
  add column column_values jsonb not null default '{}';

create table public.board_columns (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null,
  owner_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 80),
  type text not null
    check (type in ('label', 'text', 'long_text', 'date', 'checkbox')),
  settings jsonb not null default '{}',
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, board_id, owner_id),
  foreign key (board_id, owner_id)
    references public.boards(id, owner_id) on delete cascade
);

create index board_columns_board_position_idx
  on public.board_columns(board_id, position);
create index items_column_values_idx
  on public.items using gin(column_values);

alter table public.board_columns enable row level security;

create policy "Owners can read columns"
  on public.board_columns for select to authenticated
  using ((select auth.uid()) = owner_id);
create policy "Owners can create columns"
  on public.board_columns for insert to authenticated
  with check ((select auth.uid()) = owner_id);
create policy "Owners can update columns"
  on public.board_columns for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);
create policy "Owners can delete columns"
  on public.board_columns for delete to authenticated
  using ((select auth.uid()) = owner_id);

revoke all on public.board_columns from anon;
grant select, insert, update, delete on public.board_columns to authenticated;

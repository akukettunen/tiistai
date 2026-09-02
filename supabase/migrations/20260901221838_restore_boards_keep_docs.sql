create table if not exists public.board_folders (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id)
);

create table if not exists public.boards (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  description text not null default '',
  color text not null default '#6161ff',
  folder_id uuid,
  position integer not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id),
  foreign key (folder_id, owner_id)
    references public.board_folders(id, owner_id)
);

create table if not exists public.board_groups (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null,
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  color text not null default '#6161ff',
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, board_id, owner_id),
  foreign key (board_id, owner_id)
    references public.boards(id, owner_id) on delete cascade
);

create table if not exists public.board_columns (
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

create table if not exists public.items (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null,
  group_id uuid not null,
  owner_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 240),
  description text not null default '',
  status text not null default 'todo'
    check (status in ('todo', 'working', 'stuck', 'done')),
  priority text not null default 'medium'
    check (priority in ('low', 'medium', 'high', 'critical')),
  due_date date,
  column_values jsonb not null default '{}',
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (board_id, owner_id)
    references public.boards(id, owner_id) on delete cascade,
  foreign key (group_id, board_id, owner_id)
    references public.board_groups(id, board_id, owner_id) on delete cascade
);

create table if not exists public.board_automations (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null,
  owner_id uuid not null references auth.users(id) on delete cascade,
  trigger_column_id uuid not null,
  trigger_value text not null,
  target_group_id uuid not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (board_id, trigger_column_id, trigger_value),
  foreign key (board_id, owner_id)
    references public.boards(id, owner_id) on delete cascade,
  foreign key (trigger_column_id, board_id, owner_id)
    references public.board_columns(id, board_id, owner_id) on delete cascade,
  foreign key (target_group_id, board_id, owner_id)
    references public.board_groups(id, board_id, owner_id) on delete cascade
);

create index if not exists board_groups_board_position_idx
  on public.board_groups(board_id, position);
create index if not exists items_group_position_idx
  on public.items(group_id, position);
create index if not exists items_owner_status_idx
  on public.items(owner_id, status);
create index if not exists items_owner_due_date_idx
  on public.items(owner_id, due_date) where due_date is not null;
create index if not exists items_column_values_idx
  on public.items using gin(column_values);
create index if not exists boards_owner_id_idx
  on public.boards(owner_id);
create index if not exists boards_owner_archived_idx
  on public.boards(owner_id, archived_at);
create index if not exists boards_folder_owner_idx
  on public.boards(folder_id, owner_id);
create index if not exists boards_folder_position_idx
  on public.boards(owner_id, folder_id, position);
create index if not exists board_folders_owner_position_idx
  on public.board_folders(owner_id, position);
create index if not exists board_groups_owner_id_idx
  on public.board_groups(owner_id);
create index if not exists board_groups_board_owner_idx
  on public.board_groups(board_id, owner_id);
create index if not exists board_columns_board_position_idx
  on public.board_columns(board_id, position);
create index if not exists board_columns_owner_id_idx
  on public.board_columns(owner_id);
create index if not exists board_columns_board_owner_idx
  on public.board_columns(board_id, owner_id);
create index if not exists items_board_owner_idx
  on public.items(board_id, owner_id);
create index if not exists items_group_board_owner_idx
  on public.items(group_id, board_id, owner_id);
create index if not exists board_automations_owner_id_idx
  on public.board_automations(owner_id);
create index if not exists board_automations_board_owner_idx
  on public.board_automations(board_id, owner_id);
create index if not exists board_automations_trigger_board_owner_idx
  on public.board_automations(trigger_column_id, board_id, owner_id);
create index if not exists board_automations_target_board_owner_idx
  on public.board_automations(target_group_id, board_id, owner_id);

alter table public.board_folders enable row level security;
alter table public.boards enable row level security;
alter table public.board_groups enable row level security;
alter table public.board_columns enable row level security;
alter table public.items enable row level security;
alter table public.board_automations enable row level security;

drop policy if exists "Owners can read board folders" on public.board_folders;
drop policy if exists "Owners can create board folders" on public.board_folders;
drop policy if exists "Owners can update board folders" on public.board_folders;
drop policy if exists "Owners can delete board folders" on public.board_folders;
drop policy if exists "Owners can read boards" on public.boards;
drop policy if exists "Owners can create boards" on public.boards;
drop policy if exists "Owners can update boards" on public.boards;
drop policy if exists "Owners can delete boards" on public.boards;
drop policy if exists "Owners can read groups" on public.board_groups;
drop policy if exists "Owners can create groups" on public.board_groups;
drop policy if exists "Owners can update groups" on public.board_groups;
drop policy if exists "Owners can delete groups" on public.board_groups;
drop policy if exists "Owners can read columns" on public.board_columns;
drop policy if exists "Owners can create columns" on public.board_columns;
drop policy if exists "Owners can update columns" on public.board_columns;
drop policy if exists "Owners can delete columns" on public.board_columns;
drop policy if exists "Owners can read items" on public.items;
drop policy if exists "Owners can create items" on public.items;
drop policy if exists "Owners can update items" on public.items;
drop policy if exists "Owners can delete items" on public.items;
drop policy if exists "Owners can read automations" on public.board_automations;
drop policy if exists "Owners can create automations" on public.board_automations;
drop policy if exists "Owners can update automations" on public.board_automations;
drop policy if exists "Owners can delete automations" on public.board_automations;

create policy "Owners can read board folders"
  on public.board_folders for select to authenticated
  using ((select auth.uid()) = owner_id);
create policy "Owners can create board folders"
  on public.board_folders for insert to authenticated
  with check ((select auth.uid()) = owner_id);
create policy "Owners can update board folders"
  on public.board_folders for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);
create policy "Owners can delete board folders"
  on public.board_folders for delete to authenticated
  using ((select auth.uid()) = owner_id);

create policy "Owners can read boards"
  on public.boards for select to authenticated
  using ((select auth.uid()) = owner_id);
create policy "Owners can create boards"
  on public.boards for insert to authenticated
  with check ((select auth.uid()) = owner_id);
create policy "Owners can update boards"
  on public.boards for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);
create policy "Owners can delete boards"
  on public.boards for delete to authenticated
  using ((select auth.uid()) = owner_id);

create policy "Owners can read groups"
  on public.board_groups for select to authenticated
  using ((select auth.uid()) = owner_id);
create policy "Owners can create groups"
  on public.board_groups for insert to authenticated
  with check ((select auth.uid()) = owner_id);
create policy "Owners can update groups"
  on public.board_groups for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);
create policy "Owners can delete groups"
  on public.board_groups for delete to authenticated
  using ((select auth.uid()) = owner_id);

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

create policy "Owners can read items"
  on public.items for select to authenticated
  using ((select auth.uid()) = owner_id);
create policy "Owners can create items"
  on public.items for insert to authenticated
  with check ((select auth.uid()) = owner_id);
create policy "Owners can update items"
  on public.items for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);
create policy "Owners can delete items"
  on public.items for delete to authenticated
  using ((select auth.uid()) = owner_id);

create policy "Owners can read automations"
  on public.board_automations for select to authenticated
  using ((select auth.uid()) = owner_id);
create policy "Owners can create automations"
  on public.board_automations for insert to authenticated
  with check ((select auth.uid()) = owner_id);
create policy "Owners can update automations"
  on public.board_automations for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);
create policy "Owners can delete automations"
  on public.board_automations for delete to authenticated
  using ((select auth.uid()) = owner_id);

revoke all on public.board_folders, public.boards, public.board_groups,
  public.board_columns, public.items, public.board_automations from anon;
grant select, insert, update, delete
  on public.board_folders, public.boards, public.board_groups,
  public.board_columns, public.items, public.board_automations to authenticated;

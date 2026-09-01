create extension if not exists pgcrypto;

create table public.boards (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  description text not null default '',
  color text not null default '#6161ff',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id)
);

create table public.board_groups (
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

create table public.items (
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
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (board_id, owner_id)
    references public.boards(id, owner_id) on delete cascade,
  foreign key (group_id, board_id, owner_id)
    references public.board_groups(id, board_id, owner_id) on delete cascade
);

create index board_groups_board_position_idx
  on public.board_groups(board_id, position);
create index items_group_position_idx
  on public.items(group_id, position);
create index items_owner_status_idx
  on public.items(owner_id, status);
create index items_owner_due_date_idx
  on public.items(owner_id, due_date) where due_date is not null;

alter table public.boards enable row level security;
alter table public.board_groups enable row level security;
alter table public.items enable row level security;

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

revoke all on public.boards, public.board_groups, public.items from anon;
grant select, insert, update, delete
  on public.boards, public.board_groups, public.items to authenticated;

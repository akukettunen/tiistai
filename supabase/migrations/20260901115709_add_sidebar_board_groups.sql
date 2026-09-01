create table public.board_folders (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id)
);

alter table public.boards
  add column folder_id uuid;

alter table public.boards
  add constraint boards_folder_owner_fkey
  foreign key (folder_id, owner_id)
  references public.board_folders(id, owner_id);

create index board_folders_owner_position_idx
  on public.board_folders(owner_id, position);
create index boards_folder_owner_idx
  on public.boards(folder_id, owner_id);

alter table public.board_folders enable row level security;

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

revoke all on public.board_folders from anon;
grant select, insert, update, delete
  on public.board_folders to authenticated;

drop table if exists public.board_automations;
drop table if exists public.items;
drop table if exists public.board_columns;
drop table if exists public.board_groups;
drop table if exists public.boards;
drop table if exists public.board_folders;

create table public.doc_folders (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id)
);

create table public.docs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 240),
  content jsonb not null default '{"type":"doc","content":[{"type":"paragraph"}]}'::jsonb,
  color text not null default '#6161ff',
  folder_id uuid,
  position integer not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id),
  foreign key (folder_id, owner_id)
    references public.doc_folders(id, owner_id) on delete set null
);

create index docs_owner_id_idx
  on public.docs(owner_id);
create index docs_owner_archived_idx
  on public.docs(owner_id, archived_at);
create index docs_folder_position_idx
  on public.docs(owner_id, folder_id, position);
create index docs_folder_owner_idx
  on public.docs(folder_id, owner_id);
create index doc_folders_owner_position_idx
  on public.doc_folders(owner_id, position);

alter table public.doc_folders enable row level security;
alter table public.docs enable row level security;

create policy "Owners can read doc folders"
  on public.doc_folders for select to authenticated
  using ((select auth.uid()) = owner_id);
create policy "Owners can create doc folders"
  on public.doc_folders for insert to authenticated
  with check ((select auth.uid()) = owner_id);
create policy "Owners can update doc folders"
  on public.doc_folders for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);
create policy "Owners can delete doc folders"
  on public.doc_folders for delete to authenticated
  using ((select auth.uid()) = owner_id);

create policy "Owners can read docs"
  on public.docs for select to authenticated
  using ((select auth.uid()) = owner_id);
create policy "Owners can create docs"
  on public.docs for insert to authenticated
  with check ((select auth.uid()) = owner_id);
create policy "Owners can update docs"
  on public.docs for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);
create policy "Owners can delete docs"
  on public.docs for delete to authenticated
  using ((select auth.uid()) = owner_id);

revoke all on public.doc_folders, public.docs from anon;
grant select, insert, update, delete
  on public.doc_folders, public.docs to authenticated;

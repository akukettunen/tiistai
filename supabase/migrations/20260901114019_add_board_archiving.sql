alter table public.boards
  add column archived_at timestamptz;

create index boards_owner_archived_idx
  on public.boards(owner_id, archived_at);

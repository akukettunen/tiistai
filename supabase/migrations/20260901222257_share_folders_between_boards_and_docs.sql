insert into public.board_folders (id, owner_id, name, position, created_at, updated_at)
select id, owner_id, name, position, created_at, updated_at
from public.doc_folders
on conflict (id) do nothing;

alter table public.docs
  drop constraint docs_folder_id_owner_id_fkey;

alter table public.docs
  add constraint docs_folder_owner_fkey
  foreign key (folder_id, owner_id)
  references public.board_folders(id, owner_id)
  on delete set null;

drop table if exists public.doc_folders;

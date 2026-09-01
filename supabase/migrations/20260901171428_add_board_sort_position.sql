alter table public.boards
  add column position integer not null default 0;

with ranked as (
  select
    id,
    row_number() over (
      partition by owner_id, folder_id
      order by created_at, id
    ) - 1 as new_position
  from public.boards
)
update public.boards
set position = ranked.new_position
from ranked
where public.boards.id = ranked.id;

create index boards_folder_position_idx
  on public.boards(owner_id, folder_id, position);

-- Items can be archived (hidden from boards, Etusivu and MCP results) and restored.
alter table public.items add column archived_at timestamptz;

create index items_owner_archived_idx on public.items(owner_id) where archived_at is not null;

create table public.board_automations (
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

create index board_automations_owner_id_idx
  on public.board_automations(owner_id);
create index board_automations_board_owner_idx
  on public.board_automations(board_id, owner_id);
create index board_automations_trigger_board_owner_idx
  on public.board_automations(trigger_column_id, board_id, owner_id);
create index board_automations_target_board_owner_idx
  on public.board_automations(target_group_id, board_id, owner_id);

alter table public.board_automations enable row level security;

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

revoke all on public.board_automations from anon;
grant select, insert, update, delete
  on public.board_automations to authenticated;

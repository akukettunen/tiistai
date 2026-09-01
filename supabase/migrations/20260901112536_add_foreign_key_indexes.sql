create index boards_owner_id_idx
  on public.boards(owner_id);
create index board_groups_owner_id_idx
  on public.board_groups(owner_id);
create index board_groups_board_owner_idx
  on public.board_groups(board_id, owner_id);
create index board_columns_owner_id_idx
  on public.board_columns(owner_id);
create index board_columns_board_owner_idx
  on public.board_columns(board_id, owner_id);
create index items_board_owner_idx
  on public.items(board_id, owner_id);
create index items_group_board_owner_idx
  on public.items(group_id, board_id, owner_id);

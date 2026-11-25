-- items.status / priority / due_date were never read by the board UI; the real
-- values live in column_values (see 20261125124912_front_page_planning.sql).
-- Apply only after the MCP tools stop writing these fields.

drop index if exists public.items_owner_status_idx;
drop index if exists public.items_owner_priority_idx;
drop index if exists public.items_owner_due_date_idx;

alter table public.items
  drop column if exists status,
  drop column if exists priority,
  drop column if exists due_date;

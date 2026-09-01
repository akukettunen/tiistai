alter table public.items
  add column severity text not null default 'minor'
    check (severity in ('minor', 'major', 'critical')),
  add column category text not null default 'feature'
    check (category in ('feature', 'bug', 'improvement', 'chore')),
  add column labels text[] not null default '{}';

create index items_owner_severity_idx
  on public.items(owner_id, severity);
create index items_labels_idx
  on public.items using gin(labels);

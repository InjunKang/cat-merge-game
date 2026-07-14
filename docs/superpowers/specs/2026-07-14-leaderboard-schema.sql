create table if not exists leaderboard (
  id bigint generated always as identity primary key,
  name text not null check (char_length(name) between 1 and 12),
  score integer not null check (score >= 0),
  created_at timestamptz not null default now()
);

create index if not exists leaderboard_score_desc_idx on leaderboard (score desc);

alter table leaderboard enable row level security;

create policy "Allow public read" on leaderboard
  for select
  using (true);

create policy "Allow public insert" on leaderboard
  for insert
  with check (char_length(name) between 1 and 12 and score >= 0);

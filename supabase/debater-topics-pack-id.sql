-- Run once: make (game_id, pack_id) unique so topic archive cannot multiply.
alter table public.debater_topics add column if not exists pack_id text;

-- Remove exact duplicate archives (keep the oldest row per game_id + pack_id).
delete from public.debater_topics t
using public.debater_topics d
where t.pack_id is not null
  and d.pack_id is not null
  and t.game_id = d.game_id
  and t.pack_id = d.pack_id
  and t.id > d.id;

-- Drop the older partial index if present.
drop index if exists public.debater_topics_game_pack_uidx;

-- Full unique pair (client always sends pack_id now).
create unique index if not exists debater_topics_game_pack_uidx
  on public.debater_topics (game_id, pack_id);

-- Host archives every pack once (including other players' topics).
drop policy if exists debater_topics_insert on public.debater_topics;
create policy debater_topics_insert on public.debater_topics
  for insert to authenticated
  with check (
    suggested_by = auth.uid()
    or exists (
      select 1
      from public.debater_rooms r
      where r.id = game_id
        and r.host_user_id = auth.uid()
    )
  );

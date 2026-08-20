-- Run once on an existing Debater project.
alter table public.debater_topics add column if not exists pack_id text;

create unique index if not exists debater_topics_game_pack_uidx
  on public.debater_topics (game_id, pack_id)
  where pack_id is not null;

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

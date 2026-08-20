-- Debater-only tables (separate from WePlay `rooms` / `room_players`).
-- Primary identity is `debater_rooms.id` (= game_id). Room codes are recyclable.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Rooms
-- ---------------------------------------------------------------------------
create table if not exists public.debater_rooms (
  id            uuid primary key default gen_random_uuid(),
  room_code     text not null,
  host_user_id  uuid not null,
  status        text not null default 'lobby'
                  check (status in ('lobby', 'playing', 'paused', 'ended')),
  game_state    jsonb,
  lobby_settings jsonb,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  ended_at      timestamptz
);

-- Codes may repeat over time; only one *active* lobby/game may use a code.
create unique index if not exists debater_rooms_active_code_uidx
  on public.debater_rooms (room_code)
  where is_active = true;

create index if not exists debater_rooms_host_idx on public.debater_rooms (host_user_id);
create index if not exists debater_rooms_created_idx on public.debater_rooms (created_at desc);

-- ---------------------------------------------------------------------------
-- Players (keyed by room id, not room code)
-- ---------------------------------------------------------------------------
create table if not exists public.debater_players (
  id         bigint generated always as identity primary key,
  room_id    uuid not null references public.debater_rooms (id) on delete cascade,
  user_id    uuid not null,
  name       text not null,
  is_ready   boolean not null default false,
  joined_at  timestamptz not null default now(),
  unique (room_id, user_id)
);

create index if not exists debater_players_room_idx on public.debater_players (room_id);
create index if not exists debater_players_user_idx on public.debater_players (user_id);

-- ---------------------------------------------------------------------------
-- Topics archive (survives room close; game_id = debater_rooms.id)
-- ---------------------------------------------------------------------------
create table if not exists public.debater_topics (
  id                 bigint generated always as identity primary key,
  game_id            uuid not null,
  room_code          text not null,
  topic              text not null,
  stance_a           text not null,
  stance_b           text not null,
  suggested_by       uuid not null,
  suggested_by_name  text,
  created_at         timestamptz not null default now()
);

create index if not exists debater_topics_game_id_idx on public.debater_topics (game_id);
create index if not exists debater_topics_created_idx on public.debater_topics (created_at desc);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public.debater_is_room_member(p_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.debater_players p
    where p.room_id = p_room_id
      and p.user_id = auth.uid()
  );
$$;

create or replace function public.debater_active_room_id(p_room_code text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select r.id
  from public.debater_rooms r
  where r.room_code = upper(trim(p_room_code))
    and r.is_active = true
  limit 1;
$$;

-- Shallow-merge game_state (same idea as WePlay patch_room_game_state).
create or replace function public.patch_debater_game_state(
  p_room_code text,
  p_patch jsonb,
  p_replace boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  rid uuid;
begin
  rid := public.debater_active_room_id(p_room_code);
  if rid is null then
    raise exception 'Debater room not found';
  end if;
  if auth.uid() is null or not public.debater_is_room_member(rid) then
    raise exception 'Not a member of this Debater room';
  end if;

  if p_replace then
    update public.debater_rooms
    set game_state = coalesce(p_patch, '{}'::jsonb)
    where id = rid;
  else
    update public.debater_rooms
    set game_state = coalesce(game_state, '{}'::jsonb) || coalesce(p_patch, '{}'::jsonb)
    where id = rid;
  end if;
end;
$$;

create or replace function public.close_debater_room(p_room_code text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  rid uuid;
  host uuid;
begin
  select id, host_user_id into rid, host
  from public.debater_rooms
  where room_code = upper(trim(p_room_code))
    and is_active = true
  limit 1;

  if rid is null then
    return;
  end if;
  if auth.uid() is null or auth.uid() <> host then
    raise exception 'Only the host can close this Debater room';
  end if;

  update public.debater_rooms
  set is_active = false,
      status = 'ended',
      ended_at = now()
  where id = rid;

  delete from public.debater_players where room_id = rid;
end;
$$;

grant execute on function public.debater_is_room_member(uuid) to anon, authenticated;
grant execute on function public.debater_active_room_id(text) to anon, authenticated;
grant execute on function public.patch_debater_game_state(text, jsonb, boolean) to anon, authenticated;
grant execute on function public.close_debater_room(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.debater_rooms enable row level security;
alter table public.debater_players enable row level security;
alter table public.debater_topics enable row level security;

drop policy if exists debater_rooms_select on public.debater_rooms;
create policy debater_rooms_select on public.debater_rooms
  for select to authenticated
  using (is_active = true or host_user_id = auth.uid() or public.debater_is_room_member(id));

drop policy if exists debater_rooms_insert on public.debater_rooms;
create policy debater_rooms_insert on public.debater_rooms
  for insert to authenticated
  with check (host_user_id = auth.uid());

drop policy if exists debater_rooms_update on public.debater_rooms;
create policy debater_rooms_update on public.debater_rooms
  for update to authenticated
  using (host_user_id = auth.uid() or public.debater_is_room_member(id))
  with check (host_user_id = auth.uid() or public.debater_is_room_member(id));

drop policy if exists debater_players_select on public.debater_players;
create policy debater_players_select on public.debater_players
  for select to authenticated
  using (public.debater_is_room_member(room_id) or user_id = auth.uid());

drop policy if exists debater_players_insert on public.debater_players;
create policy debater_players_insert on public.debater_players
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.debater_rooms r
      where r.id = room_id and r.is_active = true
    )
  );

drop policy if exists debater_players_update on public.debater_players;
create policy debater_players_update on public.debater_players
  for update to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.debater_rooms r
      where r.id = room_id and r.host_user_id = auth.uid()
    )
  );

drop policy if exists debater_players_delete on public.debater_players;
create policy debater_players_delete on public.debater_players
  for delete to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.debater_rooms r
      where r.id = room_id and r.host_user_id = auth.uid()
    )
  );

drop policy if exists debater_topics_select on public.debater_topics;
create policy debater_topics_select on public.debater_topics
  for select to authenticated
  using (true);

drop policy if exists debater_topics_insert on public.debater_topics;
create policy debater_topics_insert on public.debater_topics
  for insert to authenticated
  with check (suggested_by = auth.uid());

-- Realtime (ignore errors if already added)
do $$
begin
  begin
    alter publication supabase_realtime add table public.debater_rooms;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.debater_players;
  exception when duplicate_object then null;
  end;
end $$;

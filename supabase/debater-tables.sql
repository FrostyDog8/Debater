-- Debater: project-specific rooms table
-- Tracks each hosted game room with active/inactive status and game_id for code reuse.
create table if not exists debater_rooms (
  id           bigint generated always as identity primary key,
  room_code    text        not null,
  game_id      text        not null default gen_random_uuid()::text,
  host_id      text        not null,
  is_active    boolean     not null default true,
  player_count int         not null default 0,
  created_at   timestamptz not null default now(),
  ended_at     timestamptz
);

create index if not exists debater_rooms_code_idx on debater_rooms (room_code);
create index if not exists debater_rooms_game_id_idx on debater_rooms (game_id);

-- Debater: topics table
-- Stores every topic and stance pair ever submitted in any game, along with who
-- suggested it, who played it as debaters, and which game it was part of.
create table if not exists debater_topics (
  id           bigint generated always as identity primary key,
  game_id      text        not null,
  room_code    text        not null,
  topic        text        not null,
  stance_a     text        not null,
  stance_b     text        not null,
  suggested_by text        not null,   -- player id of the pack author
  debater_a    text,                    -- player id for side A (null if pack unused)
  debater_b    text,                    -- player id for side B
  round_index  int,
  match_index  int,
  created_at   timestamptz not null default now()
);

create index if not exists debater_topics_game_id_idx on debater_topics (game_id);
create index if not exists debater_topics_room_code_idx on debater_topics (room_code);

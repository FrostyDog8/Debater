# Debater Supabase setup

Debater uses **its own tables**, not WePlay’s `rooms` / `room_players`.

## One-time: run the SQL

1. Open your Supabase project → **SQL Editor**
2. Paste and run [`debater-tables.sql`](./debater-tables.sql)

That creates:

| Table | Purpose |
|---|---|
| `debater_rooms` | Debater lobbies/games. PK = `id` (this is the **game id**). `room_code` is only a join code and can be reused after a room ends (`is_active = false`). |
| `debater_players` | Players in a room, keyed by `room_id` (not code). |
| `debater_topics` | Every topic a player submits, with `game_id`, stances, and who suggested it. |

Also adds:

- `patch_debater_game_state` — merges live game JSON
- `close_debater_room` — soft-closes a room so its code can be recycled
- RLS policies + Realtime publication for rooms/players

## Where to look in the dashboard

- Active games: **Table Editor → `debater_rooms`** (`is_active = true`)
- Suggested topics: **Table Editor → `debater_topics`** (filter by `game_id`)

## Notes

- Topics stay after a room closes (no cascade delete from rooms).
- Closing a room sets `is_active = false` / `status = 'ended'` and clears players; the row (and its `id` / game id) remains for history.
- Anonymous sign-in must stay enabled (same as before).
- If `debater_topics` already exists, run [`debater-topics-pack-id.sql`](./debater-topics-pack-id.sql) so each pack is stored once (`game_id` + `pack_id`) and the host can archive all room topics.
- If “Play again” ever desyncs host vs guests, run [`debater-patch-playing-only.sql`](./debater-patch-playing-only.sql) so game patches are ignored while the room is in lobby (also included in a fresh `debater-tables.sql`).

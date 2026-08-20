-- Ignore game_state patches when the room is not actively playing.
-- Prevents late champion/tick patches from resurrecting an old game after "Play again".
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
  room_status text;
begin
  rid := public.debater_active_room_id(p_room_code);
  if rid is null then
    raise exception 'Debater room not found';
  end if;
  if auth.uid() is null or not public.debater_is_room_member(rid) then
    raise exception 'Not a member of this Debater room';
  end if;

  select status into room_status from public.debater_rooms where id = rid;
  if room_status is distinct from 'playing' then
    return;
  end if;

  if p_replace then
    update public.debater_rooms
    set game_state = coalesce(p_patch, '{}'::jsonb)
    where id = rid
      and status = 'playing';
  else
    update public.debater_rooms
    set game_state = coalesce(game_state, '{}'::jsonb) || coalesce(p_patch, '{}'::jsonb)
    where id = rid
      and status = 'playing';
  end if;
end;
$$;

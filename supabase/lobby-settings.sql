-- Optional: run in the Supabase SQL editor so host lobby settings persist for later joiners.
-- Live devices also get settings over the room realtime channel.

create or replace function public.patch_room_lobby_settings(p_room_code text, p_settings jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text := upper(trim(p_room_code));
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  update public.rooms
  set game_state = coalesce(game_state, '{}'::jsonb) || jsonb_build_object('lobbySettings', coalesce(p_settings, '{}'::jsonb))
  where code = v_code
    and host_user_id = auth.uid()
    and status = 'lobby';

  if not found then
    raise exception 'Could not save lobby settings (not host, or not in lobby)';
  end if;

  begin
    update public.rooms
    set lobby_settings = coalesce(p_settings, '{}'::jsonb)
    where code = v_code
      and host_user_id = auth.uid()
      and status = 'lobby';
  exception
    when undefined_column then
      null;
  end;
end;
$$;

grant execute on function public.patch_room_lobby_settings(text, jsonb) to authenticated;

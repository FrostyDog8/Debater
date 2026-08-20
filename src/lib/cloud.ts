import type { RealtimeChannel } from '@supabase/supabase-js';
import { randomRoomCode, type Player, type Room } from './session';
import { supabase } from './supabase';

export class LobbyNotFoundError extends Error {
  constructor() {
    super("Lobby doesn't exist");
    this.name = 'LobbyNotFoundError';
  }
}

export function isLobbyNotFoundError(e: unknown): boolean {
  return e instanceof LobbyNotFoundError || (e as Error)?.name === 'LobbyNotFoundError';
}

type RoomRow = {
  id: string;
  room_code: string;
  host_user_id: string;
  status: string | null;
  game_state: unknown | null;
  lobby_settings: unknown | null;
  is_active: boolean;
  created_at: string;
  ended_at: string | null;
};

type PlayerRow = {
  room_id: string;
  user_id: string;
  name: string;
  is_ready: boolean;
  joined_at: string;
};

function roomFromRows(room: RoomRow, players: PlayerRow[]): Room {
  const mapped: Player[] = players
    .sort((a, b) => a.joined_at.localeCompare(b.joined_at))
    .map((p) => ({ id: p.user_id, name: p.name, isReady: !!p.is_ready }));
  return {
    roomCode: room.room_code,
    gameId: room.id,
    hostId: room.host_user_id,
    status: room.status === 'playing' ? 'playing' : room.status === 'paused' ? 'paused' : 'lobby',
    gameState: room.game_state ?? null,
    lobbySettings: room.lobby_settings ?? null,
    players: mapped,
  };
}

function isMissingRpc(error: { message?: string; code?: string }): boolean {
  const msg = String(error.message ?? '').toLowerCase();
  return error.code === 'PGRST202' || msg.includes('could not find the function');
}

async function fetchActiveRoomRow(roomCode: string): Promise<RoomRow> {
  const code = roomCode.trim().toUpperCase();
  const { data, error } = await supabase
    .from('debater_rooms')
    .select('*')
    .eq('room_code', code)
    .eq('is_active', true)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new LobbyNotFoundError();
  return data as RoomRow;
}

export async function cloudCreateRoom(params: { hostUserId: string; hostName: string }): Promise<string> {
  const nowIso = new Date().toISOString();
  let lastError: unknown = null;

  for (let attempt = 0; attempt < 10; attempt++) {
    const code = randomRoomCode();
    const { data: room, error: roomErr } = await supabase
      .from('debater_rooms')
      .insert({
        room_code: code,
        host_user_id: params.hostUserId,
        status: 'lobby',
        is_active: true,
        lobby_settings: null,
        game_state: null,
      })
      .select('*')
      .single();

    if (roomErr) {
      lastError = roomErr;
      // Unique violation on active room_code — try another code.
      if (roomErr.code === '23505') continue;
      throw roomErr;
    }

    const row = room as RoomRow;
    const { error: playerErr } = await supabase.from('debater_players').insert({
      room_id: row.id,
      user_id: params.hostUserId,
      name: params.hostName.trim() || 'Host',
      is_ready: true,
      joined_at: nowIso,
    });
    if (playerErr) {
      await supabase.from('debater_rooms').delete().eq('id', row.id);
      throw playerErr;
    }
    return row.room_code;
  }

  throw lastError instanceof Error ? lastError : new Error('Could not allocate a room code');
}

export async function cloudJoinRoom(params: { roomCode: string; userId: string; name: string }) {
  const room = await fetchActiveRoomRow(params.roomCode);
  const { error } = await supabase.from('debater_players').upsert(
    {
      room_id: room.id,
      user_id: params.userId,
      name: params.name.trim() || 'Player',
      is_ready: false,
      joined_at: new Date().toISOString(),
    },
    { onConflict: 'room_id,user_id' },
  );
  if (error) throw error;
}

export async function cloudLeaveRoom(params: { roomCode: string; userId: string }) {
  let room: RoomRow;
  try {
    room = await fetchActiveRoomRow(params.roomCode);
  } catch (e) {
    if (isLobbyNotFoundError(e)) return;
    throw e;
  }

  await supabase.from('debater_players').delete().eq('room_id', room.id).eq('user_id', params.userId);
  if (room.host_user_id === params.userId) {
    await cloudDeleteRoom({ roomCode: room.room_code, hostUserId: params.userId });
  }
}

export async function cloudSetReady(params: { roomCode: string; userId: string; isReady: boolean }) {
  const room = await fetchActiveRoomRow(params.roomCode);
  const { error } = await supabase
    .from('debater_players')
    .update({ is_ready: params.isReady })
    .eq('room_id', room.id)
    .eq('user_id', params.userId);
  if (error) throw error;
}

export async function cloudRename(params: { roomCode: string; userId: string; name: string }) {
  const trimmed = params.name.trim();
  if (!trimmed) return;
  const room = await fetchActiveRoomRow(params.roomCode);
  const { error } = await supabase
    .from('debater_players')
    .update({ name: trimmed })
    .eq('room_id', room.id)
    .eq('user_id', params.userId);
  if (error) throw error;
}

export async function cloudDeleteRoom(params: { roomCode: string; hostUserId: string }) {
  const code = params.roomCode.trim().toUpperCase();
  const { error: rpcErr } = await supabase.rpc('close_debater_room', { p_room_code: code });
  if (!rpcErr) return;
  if (!isMissingRpc(rpcErr)) throw rpcErr;

  const room = await fetchActiveRoomRow(code).catch((e) => {
    if (isLobbyNotFoundError(e)) return null;
    throw e;
  });
  if (!room) return;
  if (room.host_user_id !== params.hostUserId) throw new Error('Only the host can close this room');

  await supabase.from('debater_players').delete().eq('room_id', room.id);
  const { error } = await supabase
    .from('debater_rooms')
    .update({ is_active: false, status: 'ended', ended_at: new Date().toISOString() })
    .eq('id', room.id)
    .eq('host_user_id', params.hostUserId);
  if (error) throw error;
}

export async function cloudKickPlayer(params: { roomCode: string; hostUserId: string; targetUserId: string }) {
  const room = await fetchActiveRoomRow(params.roomCode);
  if (room.host_user_id !== params.hostUserId) throw new Error('Only the host can kick players');
  const { error } = await supabase
    .from('debater_players')
    .delete()
    .eq('room_id', room.id)
    .eq('user_id', params.targetUserId);
  if (error) throw error;
}

export async function cloudPatchLobbySettings(params: { roomCode: string; hostUserId: string; settings: unknown }) {
  const room = await fetchActiveRoomRow(params.roomCode);
  if (room.host_user_id !== params.hostUserId) throw new Error('Only the host can change lobby settings');
  if (room.status !== 'lobby') return;

  const { data, error } = await supabase
    .from('debater_rooms')
    .update({ lobby_settings: params.settings })
    .eq('id', room.id)
    .eq('host_user_id', params.hostUserId)
    .eq('status', 'lobby')
    .select('id');
  if (error) throw error;
  if (!data?.length) throw new Error('Could not save lobby settings');
}

export async function cloudStartGame(params: { roomCode: string; hostUserId: string; gameState: unknown }) {
  const room = await fetchActiveRoomRow(params.roomCode);
  if (room.host_user_id !== params.hostUserId) throw new Error('Only the host can start the game');
  const { error } = await supabase
    .from('debater_rooms')
    .update({ status: 'playing', game_state: params.gameState })
    .eq('id', room.id)
    .eq('host_user_id', params.hostUserId);
  if (error) throw error;
}

export async function cloudPatchGameState(params: { roomCode: string; patch: unknown; replace?: boolean }) {
  const code = params.roomCode.trim().toUpperCase();
  const { error: rpcErr } = await supabase.rpc('patch_debater_game_state', {
    p_room_code: code,
    p_patch: params.patch,
    p_replace: !!params.replace,
  });
  if (!rpcErr) return;
  if (!isMissingRpc(rpcErr)) throw rpcErr;

  // Fallback if RPC is missing: client-side shallow merge (racy but workable).
  const room = await fetchActiveRoomRow(code);
  const prev =
    room.game_state && typeof room.game_state === 'object' && !Array.isArray(room.game_state)
      ? (room.game_state as Record<string, unknown>)
      : {};
  const patch =
    params.patch && typeof params.patch === 'object' && !Array.isArray(params.patch)
      ? (params.patch as Record<string, unknown>)
      : {};
  const next = params.replace ? patch : { ...prev, ...patch };
  const { error } = await supabase.from('debater_rooms').update({ game_state: next }).eq('id', room.id);
  if (error) throw error;
}

export async function cloudReturnToLobby(params: { roomCode: string; hostUserId: string; settings?: unknown }) {
  const room = await fetchActiveRoomRow(params.roomCode);
  if (room.host_user_id !== params.hostUserId) throw new Error('Only the host can return to lobby');
  const { error } = await supabase
    .from('debater_rooms')
    .update({
      status: 'lobby',
      game_state: null,
      lobby_settings: params.settings ?? room.lobby_settings,
    })
    .eq('id', room.id)
    .eq('host_user_id', params.hostUserId);
  if (error) throw error;
}

export async function cloudFetchRoom(roomCode: string): Promise<Room> {
  const room = await fetchActiveRoomRow(roomCode);
  const { data: players, error: playerErr } = await supabase
    .from('debater_players')
    .select('*')
    .eq('room_id', room.id);
  if (playerErr) throw playerErr;
  return roomFromRows(room, (players ?? []) as PlayerRow[]);
}

/** Persist a player-suggested topic for analytics / history (game_id = debater_rooms.id). */
export async function cloudRecordTopic(params: {
  gameId: string;
  roomCode: string;
  packId?: string;
  topic: string;
  stanceA: string;
  stanceB: string;
  suggestedBy: string;
  suggestedByName?: string;
}) {
  const row: Record<string, string | null> = {
    game_id: params.gameId,
    room_code: params.roomCode.trim().toUpperCase(),
    topic: params.topic.trim(),
    stance_a: params.stanceA.trim(),
    stance_b: params.stanceB.trim(),
    suggested_by: params.suggestedBy,
    suggested_by_name: params.suggestedByName?.trim() || null,
  };
  if (params.packId) row.pack_id = params.packId;

  const { error } = await supabase.from('debater_topics').insert(row);
  // Unique (game_id, pack_id) — ignore duplicate inserts from retries.
  if (error && error.code === '23505') return;
  if (error) throw error;
}

export function cloudSubscribeRoom(params: {
  roomCode: string;
  onRoom(room: Room): void;
  onRoomClosed(): void;
  onError(message: string): void;
  onLobbySettings?(settings: unknown): void;
  onSettingsRequested?(): void;
}): { unsubscribe(): void; publishLobbySettings(settings: unknown): void } {
  const code = params.roomCode.trim().toUpperCase();
  let channel: RealtimeChannel | null = null;
  let refreshTimer: number | null = null;
  let cancelled = false;
  let lastLobbySettings: unknown = null;

  const applyRoom = (room: Room) => {
    if (room.lobbySettings != null) lastLobbySettings = room.lobbySettings;
    else if (lastLobbySettings != null) room = { ...room, lobbySettings: lastLobbySettings };
    params.onRoom(room);
  };

  const refresh = async () => {
    try {
      const room = await cloudFetchRoom(code);
      if (!cancelled) applyRoom(room);
    } catch (e: unknown) {
      if (cancelled) return;
      if (isLobbyNotFoundError(e)) params.onRoomClosed();
      else params.onError(String((e as Error)?.message ?? e));
    }
  };

  void refresh();
  channel = supabase
    .channel(`debater:${code}`, { config: { broadcast: { ack: true } } })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'debater_players' }, () => {
      void refresh();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'debater_rooms', filter: `room_code=eq.${code}` }, () =>
      refresh(),
    )
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'debater_rooms', filter: `room_code=eq.${code}` }, (payload) => {
      const next = payload.new as { is_active?: boolean } | null;
      if (next && next.is_active === false && !cancelled) params.onRoomClosed();
    })
    .on('broadcast', { event: 'lobby-settings' }, (e) => {
      if (cancelled) return;
      lastLobbySettings = e.payload;
      params.onLobbySettings?.(e.payload);
    })
    .on('broadcast', { event: 'need-lobby-settings' }, () => {
      if (!cancelled) params.onSettingsRequested?.();
    })
    .subscribe((status) => {
      if (status === 'CHANNEL_ERROR') params.onError('Realtime channel error');
      if (status === 'SUBSCRIBED') {
        void refresh();
        void channel?.send({ type: 'broadcast', event: 'need-lobby-settings', payload: {} });
      }
    });

  refreshTimer = window.setInterval(() => {
    if (!cancelled) void refresh();
  }, 1500);

  return {
    publishLobbySettings(settings: unknown) {
      lastLobbySettings = settings;
      void channel?.send({ type: 'broadcast', event: 'lobby-settings', payload: settings });
    },
    unsubscribe() {
      cancelled = true;
      if (refreshTimer != null) window.clearInterval(refreshTimer);
      if (channel) supabase.removeChannel(channel);
      channel = null;
    },
  };
}

export type GamePayload = {
  engine: unknown;
  [key: string]: unknown;
};

export function playerInputKey(userId: string): string {
  return `in_${userId.replace(/-/g, '').slice(0, 12)}`;
}

import type { RealtimeChannel } from '@supabase/supabase-js';
import { GAME_ID } from './engine';
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
  code: string;
  host_user_id: string;
  created_at: string;
  game_id?: string | null;
  status?: string | null;
  game_state?: unknown | null;
  lobby_settings?: unknown | null;
};

type PlayerRow = {
  room_code: string;
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
    roomCode: room.code,
    hostId: room.host_user_id,
    gameId: room.game_id ?? null,
    status: room.status === 'playing' ? 'playing' : room.status === 'paused' ? 'paused' : 'lobby',
    gameState: room.game_state ?? null,
    lobbySettings: room.lobby_settings ?? null,
    players: mapped,
  };
}

function isMissingRpc(error: { message?: string; code?: string }): boolean {
  const msg = String(error.message ?? '').toLowerCase();
  return (error.code === 'PGRST202' || msg.includes('could not find the function')) && true;
}

export async function cloudCreateRoom(params: { hostUserId: string; hostName: string }): Promise<string> {
  const code = randomRoomCode();
  const nowIso = new Date().toISOString();
  const { error: roomErr } = await supabase.from('rooms').insert({
    code,
    host_user_id: params.hostUserId,
    created_at: nowIso,
    game_id: GAME_ID,
    status: 'lobby',
  });
  if (roomErr) throw roomErr;
  const { error: playerErr } = await supabase.from('room_players').insert({
    room_code: code,
    user_id: params.hostUserId,
    name: params.hostName.trim() || 'Host',
    is_ready: true,
    joined_at: nowIso,
  } satisfies PlayerRow);
  if (playerErr) throw playerErr;
  return code;
}

export async function cloudJoinRoom(params: { roomCode: string; userId: string; name: string }) {
  const code = params.roomCode.trim().toUpperCase();
  const { data: room, error: roomErr } = await supabase.from('rooms').select('*').eq('code', code).maybeSingle();
  if (roomErr) throw roomErr;
  if (!room) throw new LobbyNotFoundError();
  if (room.game_id && room.game_id !== GAME_ID) {
    throw new Error('That room is running a different game.');
  }
  const { error } = await supabase.from('room_players').upsert(
    {
      room_code: code,
      user_id: params.userId,
      name: params.name.trim() || 'Player',
      is_ready: false,
      joined_at: new Date().toISOString(),
    },
    { onConflict: 'room_code,user_id' },
  );
  if (error) throw error;
}

export async function cloudLeaveRoom(params: { roomCode: string; userId: string }) {
  const code = params.roomCode.trim().toUpperCase();
  const { data: room } = await supabase.from('rooms').select('host_user_id').eq('code', code).maybeSingle();
  if (!room) return;
  await supabase.from('room_players').delete().eq('room_code', code).eq('user_id', params.userId);
  if (room.host_user_id === params.userId) {
    await cloudDeleteRoom({ roomCode: code, hostUserId: params.userId });
  }
}

export async function cloudSetReady(params: { roomCode: string; userId: string; isReady: boolean }) {
  const { error } = await supabase
    .from('room_players')
    .update({ is_ready: params.isReady })
    .eq('room_code', params.roomCode.trim().toUpperCase())
    .eq('user_id', params.userId);
  if (error) throw error;
}

export async function cloudRename(params: { roomCode: string; userId: string; name: string }) {
  const trimmed = params.name.trim();
  if (!trimmed) return;
  const { error } = await supabase
    .from('room_players')
    .update({ name: trimmed })
    .eq('room_code', params.roomCode.trim().toUpperCase())
    .eq('user_id', params.userId);
  if (error) throw error;
}

export async function cloudDeleteRoom(params: { roomCode: string; hostUserId: string }) {
  const code = params.roomCode.trim().toUpperCase();
  const { error: rpcErr } = await supabase.rpc('close_room', { p_room_code: code });
  if (!rpcErr) return;
  if (!isMissingRpc(rpcErr)) throw rpcErr;
  const { error } = await supabase.from('rooms').delete().eq('code', code).eq('host_user_id', params.hostUserId);
  if (error) throw error;
}

export async function cloudKickPlayer(params: { roomCode: string; hostUserId: string; targetUserId: string }) {
  const code = params.roomCode.trim().toUpperCase();
  const { error: rpcErr } = await supabase.rpc('kick_player', {
    p_room_code: code,
    p_target_user_id: params.targetUserId,
  });
  if (!rpcErr) return;
  if (!isMissingRpc(rpcErr)) throw rpcErr;
  const { error } = await supabase.from('room_players').delete().eq('room_code', code).eq('user_id', params.targetUserId);
  if (error) throw error;
}

export async function cloudPatchLobbySettings(params: { roomCode: string; hostUserId: string; settings: unknown }) {
  const { error } = await supabase
    .from('rooms')
    .update({ lobby_settings: params.settings })
    .eq('code', params.roomCode.trim().toUpperCase())
    .eq('host_user_id', params.hostUserId)
    .eq('status', 'lobby');
  if (error && !String(error.message ?? '').toLowerCase().includes('lobby_settings')) throw error;
}

export async function cloudStartGame(params: { roomCode: string; hostUserId: string; gameState: unknown }) {
  const code = params.roomCode.trim().toUpperCase();
  const { error: rpcErr } = await supabase.rpc('start_room_game', {
    p_room_code: code,
    p_game_state: params.gameState,
  });
  if (!rpcErr) return;
  if (!isMissingRpc(rpcErr)) throw rpcErr;
  const { error } = await supabase
    .from('rooms')
    .update({ status: 'playing', game_id: GAME_ID, game_state: params.gameState })
    .eq('code', code)
    .eq('host_user_id', params.hostUserId);
  if (error) throw error;
}

export async function cloudPatchGameState(params: { roomCode: string; patch: unknown; replace?: boolean }) {
  const { error } = await supabase.rpc('patch_room_game_state', {
    p_room_code: params.roomCode.trim().toUpperCase(),
    p_patch: params.patch,
    p_replace: !!params.replace,
  });
  if (error) throw error;
}

export async function cloudReturnToLobby(params: { roomCode: string; hostUserId: string }) {
  const code = params.roomCode.trim().toUpperCase();
  const { error: rpcErr } = await supabase.rpc('return_room_to_lobby', { p_room_code: code });
  if (!rpcErr) return;
  if (!isMissingRpc(rpcErr)) throw rpcErr;
  await supabase
    .from('rooms')
    .update({ status: 'lobby', game_state: null })
    .eq('code', code)
    .eq('host_user_id', params.hostUserId);
}

export async function cloudFetchRoom(roomCode: string): Promise<Room> {
  const code = roomCode.trim().toUpperCase();
  const { data: room, error: roomErr } = await supabase.from('rooms').select('*').eq('code', code).maybeSingle();
  if (roomErr) throw roomErr;
  if (!room) throw new LobbyNotFoundError();
  const { data: players, error: playerErr } = await supabase.from('room_players').select('*').eq('room_code', code);
  if (playerErr) throw playerErr;
  return roomFromRows(room as RoomRow, (players ?? []) as PlayerRow[]);
}

export function cloudSubscribeRoom(params: {
  roomCode: string;
  onRoom(room: Room): void;
  onRoomClosed(): void;
  onError(message: string): void;
}): { unsubscribe(): void } {
  const code = params.roomCode.trim().toUpperCase();
  let channel: RealtimeChannel | null = null;
  let cancelled = false;

  const refresh = async () => {
    try {
      const room = await cloudFetchRoom(code);
      if (!cancelled) params.onRoom(room);
    } catch (e: unknown) {
      if (cancelled) return;
      if (isLobbyNotFoundError(e)) params.onRoomClosed();
      else params.onError(String((e as Error)?.message ?? e));
    }
  };

  void refresh();
  channel = supabase
    .channel(`room:${code}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'room_players', filter: `room_code=eq.${code}` }, () =>
      refresh(),
    )
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'rooms', filter: `code=eq.${code}` }, () => refresh())
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'rooms', filter: `code=eq.${code}` }, () => {
      if (!cancelled) params.onRoomClosed();
    })
    .subscribe((status) => {
      if (status === 'CHANNEL_ERROR') params.onError('Realtime channel error');
    });

  return {
    unsubscribe() {
      cancelled = true;
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

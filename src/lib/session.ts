export type PlayerId = string;

export type Player = {
  id: PlayerId;
  name: string;
  isReady: boolean;
};

export type Room = {
  roomCode: string;
  hostId: PlayerId;
  gameId: string | null;
  status: 'lobby' | 'playing' | 'paused';
  gameState: unknown | null;
  lobbySettings: unknown | null;
  players: Player[];
};

export function randomRoomCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let out = '';
  for (let i = 0; i < 4; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)]!;
  return out;
}

export const NAME_KEY = 'debate-roulette-name';

export function loadName(): string {
  try {
    return localStorage.getItem(NAME_KEY)?.trim() || '';
  } catch {
    return '';
  }
}

export function saveName(name: string) {
  try {
    localStorage.setItem(NAME_KEY, name.trim());
  } catch {
    /* ignore */
  }
}

export function roomHash(code: string): string {
  return `#/r/${code.trim().toUpperCase()}`;
}

export function parseRoomFromHash(hash = window.location.hash): string | null {
  const m = hash.match(/^#\/r\/([A-Za-z]{4})/i);
  return m ? m[1]!.toUpperCase() : null;
}

export function joinUrl(code: string): string {
  const origin = window.location.origin;
  const base = import.meta.env.BASE_URL || '/';
  const path = `${origin}${base.replace(/\/?$/, '/')}`;
  return `${path}${roomHash(code)}`;
}

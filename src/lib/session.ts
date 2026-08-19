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
  do {
    out = '';
    for (let i = 0; i < 4; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)]!;
  } while (out === 'TEST');
  return out;
}

export const NAME_KEY = 'debate-roulette-name';

export function labSeat(): string {
  try {
    return new URLSearchParams(window.location.search).get('seat')?.replace(/[^\w-]/g, '').slice(0, 8) ?? '';
  } catch {
    return '';
  }
}

function nameStore(): Storage {
  return labSeat() ? window.sessionStorage : window.localStorage;
}

function nameKey(): string {
  const seat = labSeat();
  return seat ? `${NAME_KEY}-${seat}` : NAME_KEY;
}

export function loadName(): string {
  try {
    const saved = nameStore().getItem(nameKey())?.trim();
    if (saved) return saved;
    const seat = labSeat();
    return seat ? `Player ${seat}` : '';
  } catch {
    return '';
  }
}

export function saveName(name: string) {
  try {
    nameStore().setItem(nameKey(), name.trim());
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

import type { Engine, PlayerId } from './engine';
import { addPack, parseEngine, submitSplit, voteFinalTopic } from './engine';
import { playerInputKey, type GamePayload } from './cloud';

export type PlayerInput = {
  pack?: { topic: string; stanceA: string; stanceB: string };
  clapsA?: number;
  clapsB?: number;
  lastClapAt?: number;
  splitA?: number;
  topicVote?: string;
};

export function readInputs(payload: GamePayload | null | undefined, playerIds: PlayerId[]): Record<PlayerId, PlayerInput> {
  const out: Record<PlayerId, PlayerInput> = {};
  if (!payload) return out;
  for (const id of playerIds) {
    const raw = payload[playerInputKey(id)];
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) out[id] = raw as PlayerInput;
  }
  return out;
}

export function applyGuestInputs(engine: Engine, payload: GamePayload | null | undefined, roomIds: PlayerId[]): Engine {
  const inputs = readInputs(payload, roomIds);
  let e = engine;
  for (const id of roomIds) {
    const inp = inputs[id];
    if (!inp) continue;
    if (inp.pack) e = addPack(e, id, inp.pack);
    if (inp.topicVote) e = voteFinalTopic(e, id, inp.topicVote);
    if (typeof inp.splitA === 'number') e = submitSplit(e, id, inp.splitA, roomIds);
    if (typeof inp.clapsA === 'number' || typeof inp.clapsB === 'number') {
      e = {
        ...e,
        clapA: { ...e.clapA, [id]: inp.clapsA ?? e.clapA[id] ?? 0 },
        clapB: { ...e.clapB, [id]: inp.clapsB ?? e.clapB[id] ?? 0 },
      };
    }
  }
  return e;
}

export function parsePayload(raw: unknown, playerIds: PlayerId[]): { engine: Engine; payload: GamePayload } {
  const payload = (raw && typeof raw === 'object' ? raw : {}) as GamePayload;
  const engine = applyGuestInputs(parseEngine(payload.engine, playerIds), payload, playerIds);
  return { engine, payload };
}

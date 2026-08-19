import type { Engine, PlayerId } from './engine';
import { addPack, packTextReady, parseEngine, submitSplit, voteFinalTopic } from './engine';
import { playerInputKey, type GamePayload } from './cloud';

export type PlayerInput = {
  pack?: { topic: string; stanceA: string; stanceB: string } | null;
  clapsA?: number;
  clapsB?: number;
  lastClapAt?: number;
  splitA?: number | null;
  topicVote?: string | null;
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
    if (inp.pack && packTextReady(inp.pack.topic, inp.pack.stanceA, inp.pack.stanceB)) e = addPack(e, id, inp.pack);
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

export function wipedInputs(playerIds: PlayerId[]): Record<string, PlayerInput> {
  return Object.fromEntries(
    playerIds.map((id) => [
      playerInputKey(id),
      { pack: null, splitA: null, topicVote: null, clapsA: 0, clapsB: 0, lastClapAt: 0 },
    ]),
  );
}

export function wipeSplitsKeepClaps(payload: GamePayload | null | undefined, playerIds: PlayerId[]): Record<string, PlayerInput> {
  const current = readInputs(payload, playerIds);
  return Object.fromEntries(
    playerIds.map((id) => [
      playerInputKey(id),
      {
        clapsA: current[id]?.clapsA ?? 0,
        clapsB: current[id]?.clapsB ?? 0,
        lastClapAt: current[id]?.lastClapAt,
        splitA: null,
        topicVote: null,
        pack: null,
      },
    ]),
  );
}

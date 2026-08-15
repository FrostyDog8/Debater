export type PlayerId = string;

export const GAME_ID = 'debate-web';
export const MIN_START_PLAYERS = 3;
export const VOTE_POINTS = 11;
export const TWENTIETHS_PER_VOTE = 20;
export const CLAP_TWENTIETHS = 1;
export const CLAP_COOLDOWN_MS = 2000;
export const MIN_TEXT = 3;

export type SpeakMode = 'timed_turns' | 'free_for_all';

export type Settings = {
  prepSeconds: number;
  debateMinutes: number;
  speakMode: SpeakMode;
};

export const DEFAULT_SETTINGS: Settings = {
  prepSeconds: 30,
  debateMinutes: 2,
  speakMode: 'timed_turns',
};

export type Pack = {
  id: string;
  authorId: PlayerId;
  topic: string;
  stanceA: string;
  stanceB: string;
};

export type Match = {
  aId: PlayerId;
  bId: PlayerId;
  packId: string;
  swapStances: boolean;
  leftoverBonus: boolean;
};

export type Phase =
  | 'collect_packs'
  | 'collect_final_topics'
  | 'vote_final_topic'
  | 'prep'
  | 'debate'
  | 'split_vote'
  | 'match_result'
  | 'stage_result'
  | 'champion';

export type StageKind = 'n6' | 'n5' | 'n4' | 'n3' | 'final';

export type Engine = {
  settings: Settings;
  phase: Phase;
  stageKind: StageKind;
  activeIds: PlayerId[];
  packPool: Pack[];
  usedPackIds: string[];
  matches: Match[];
  matchIndex: number;
  scores: Record<PlayerId, number>;
  clapA: Record<PlayerId, number>;
  clapB: Record<PlayerId, number>;
  lastClapAt: Record<PlayerId, number>;
  splitA: Record<PlayerId, number>;
  leftoverId: PlayerId | null;
  leftoverPending: boolean;
  autoOutId: PlayerId | null;
  topicVotes: Record<PlayerId, string>;
  finalPackIds: string[];
  phaseEndsAtMs: number | null;
  turnIndex: number;
  lastPointsA: number;
  lastPointsB: number;
  lastDraw: boolean;
  championId: PlayerId | null;
  replayNote: string | null;
};

export function stageFor(n: number): StageKind {
  if (n <= 2) return 'final';
  if (n === 3) return 'n3';
  if (n === 4) return 'n4';
  if (n === 5) return 'n5';
  return 'n6';
}

export function parseSettings(raw: unknown): Settings {
  const r = (raw ?? {}) as Partial<Settings>;
  const prep = Math.max(5, Math.min(120, Number(r.prepSeconds) || DEFAULT_SETTINGS.prepSeconds));
  const debate = Math.max(1, Math.min(10, Number(r.debateMinutes) || DEFAULT_SETTINGS.debateMinutes));
  const speakMode: SpeakMode = r.speakMode === 'free_for_all' ? 'free_for_all' : 'timed_turns';
  return { prepSeconds: prep, debateMinutes: debate, speakMode };
}

function shuffled<T>(items: T[], rng: () => number): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr;
}

function sortIds(ids: PlayerId[]): PlayerId[] {
  return [...ids].sort();
}

export function createEngine(activeIds: PlayerId[], settings: Settings = DEFAULT_SETTINGS): Engine {
  const ids = sortIds(activeIds);
  return {
    settings: parseSettings(settings),
    phase: ids.length <= 2 ? 'collect_final_topics' : 'collect_packs',
    stageKind: stageFor(ids.length),
    activeIds: ids,
    packPool: [],
    usedPackIds: [],
    matches: [],
    matchIndex: 0,
    scores: Object.fromEntries(ids.map((id) => [id, 0])),
    clapA: {},
    clapB: {},
    lastClapAt: {},
    splitA: {},
    leftoverId: null,
    leftoverPending: false,
    autoOutId: null,
    topicVotes: {},
    finalPackIds: [],
    phaseEndsAtMs: null,
    turnIndex: 0,
    lastPointsA: 0,
    lastPointsB: 0,
    lastDraw: false,
    championId: null,
    replayNote: null,
  };
}

export function unusedPacks(engine: Engine): Pack[] {
  const used = new Set(engine.usedPackIds);
  return engine.packPool.filter((p) => !used.has(p.id));
}

export function hasUnusedPack(engine: Engine, authorId: PlayerId): boolean {
  return unusedPacks(engine).some((p) => p.authorId === authorId);
}

export function playersNeedingPack(engine: Engine): PlayerId[] {
  if (engine.phase === 'collect_final_topics') return [];
  return engine.activeIds.filter((id) => !hasUnusedPack(engine, id));
}

export function currentMatch(engine: Engine): Match | null {
  return engine.matches[engine.matchIndex] ?? null;
}

export function currentDebaters(engine: Engine): PlayerId[] {
  const m = currentMatch(engine);
  return m ? [m.aId, m.bId] : [];
}

export function listenersOf(engine: Engine, roomPlayerIds: PlayerId[]): PlayerId[] {
  const deb = new Set(currentDebaters(engine));
  return roomPlayerIds.filter((id) => !deb.has(id));
}

export function currentPack(engine: Engine): Pack | null {
  const m = currentMatch(engine);
  if (!m) return null;
  return engine.packPool.find((p) => p.id === m.packId) ?? null;
}

export function stancesFor(engine: Engine): { a: string; b: string } | null {
  const pack = currentPack(engine);
  const m = currentMatch(engine);
  if (!pack || !m) return null;
  if (m.swapStances) return { a: pack.stanceB, b: pack.stanceA };
  return { a: pack.stanceA, b: pack.stanceB };
}

export function turnLabel(engine: Engine): string | null {
  if (engine.phase !== 'debate') return null;
  if (engine.settings.speakMode !== 'timed_turns') return 'Open floor';
  const names = ['A opening', 'B opening', 'A closing', 'B closing'];
  return names[engine.turnIndex] ?? 'Debate';
}

export function whoseTurn(engine: Engine): 'A' | 'B' | null {
  if (engine.phase !== 'debate' || engine.settings.speakMode !== 'timed_turns') return null;
  return engine.turnIndex % 2 === 0 ? 'A' : 'B';
}

function emptyMatchInputs(): Pick<Engine, 'clapA' | 'clapB' | 'lastClapAt' | 'splitA'> {
  return { clapA: {}, clapB: {}, lastClapAt: {}, splitA: {} };
}

export function addPack(
  engine: Engine,
  authorId: PlayerId,
  entry: { topic: string; stanceA: string; stanceB: string },
  rng: () => number = Math.random,
): Engine {
  const topic = entry.topic.trim();
  const stanceA = entry.stanceA.trim();
  const stanceB = entry.stanceB.trim();
  if (topic.length < MIN_TEXT || stanceA.length < MIN_TEXT || stanceB.length < MIN_TEXT) return engine;

  if (engine.phase === 'collect_packs') {
    if (engine.activeIds.includes(authorId) && hasUnusedPack(engine, authorId)) return engine;
  } else if (engine.phase === 'collect_final_topics') {
    if (engine.activeIds.includes(authorId)) return engine;
  } else {
    return engine;
  }

  const pack: Pack = {
    id: `pack_${authorId}_${Date.now().toString(16)}_${Math.floor(rng() * 1e9).toString(16)}`,
    authorId,
    topic,
    stanceA,
    stanceB,
  };
  return {
    ...engine,
    packPool: [...engine.packPool, pack],
    finalPackIds: engine.phase === 'collect_final_topics' ? [...engine.finalPackIds, pack.id] : engine.finalPackIds,
    replayNote: null,
  };
}

export function allRequiredPacksIn(engine: Engine): boolean {
  if (engine.phase === 'collect_packs') return playersNeedingPack(engine).length === 0;
  if (engine.phase === 'collect_final_topics') {
    return listenerPacks(engine).length > 0;
  }
  return false;
}

function assignPackToMatch(
  aId: PlayerId,
  bId: PlayerId,
  pool: Pack[],
  used: Set<string>,
  rng: () => number,
): { packId: string; swapStances: boolean } {
  const eligible = pool.filter((p) => !used.has(p.id) && p.authorId !== aId && p.authorId !== bId);
  const pick = eligible[Math.floor(rng() * eligible.length)];
  if (!pick) {
    throw new Error('No valid topic pack (author would be a debater).');
  }
  used.add(pick.id);
  return { packId: pick.id, swapStances: rng() < 0.5 };
}

function pairN6(ids: PlayerId[], rng: () => number): { pairs: [PlayerId, PlayerId][]; leftover: PlayerId | null } {
  const sh = shuffled(ids, rng);
  let leftover: PlayerId | null = null;
  const work = [...sh];
  if (work.length % 2 === 1) leftover = work.pop() ?? null;
  const pairs: [PlayerId, PlayerId][] = [];
  for (let i = 0; i + 1 < work.length; i += 2) {
    pairs.push([work[i]!, work[i + 1]!]);
  }
  return { pairs, leftover };
}

function cyclePairs(ids: PlayerId[]): [PlayerId, PlayerId][] {
  const pairs: [PlayerId, PlayerId][] = [];
  const n = ids.length;
  for (let i = 0; i < n; i++) {
    pairs.push([ids[i]!, ids[(i + 1) % n]!]);
  }
  return pairs;
}

function rr3Pairs(ids: PlayerId[]): [PlayerId, PlayerId][] {
  const [a, b, c] = ids;
  if (!a || !b || !c) return [];
  return [
    [a, b],
    [b, c],
    [c, a],
  ];
}

function buildMatches(
  pairs: [PlayerId, PlayerId][],
  pool: Pack[],
  usedStart: string[],
  rng: () => number,
  leftoverBonus = false,
): { matches: Match[]; usedPackIds: string[] } {
  const used0 = new Set(usedStart);
  const available = pool.filter((p) => !used0.has(p.id));

  function search(i: number, used: Set<string>): Match[] | null {
    if (i === pairs.length) return [];
    const [aId, bId] = pairs[i]!;
    const eligible = shuffled(
      available.filter((p) => !used.has(p.id) && p.authorId !== aId && p.authorId !== bId),
      rng,
    );
    for (const pack of eligible) {
      const nextUsed = new Set(used);
      nextUsed.add(pack.id);
      const rest = search(i + 1, nextUsed);
      if (rest) {
        return [
          { aId, bId, packId: pack.id, swapStances: rng() < 0.5, leftoverBonus },
          ...rest,
        ];
      }
    }
    return null;
  }

  const matches = search(0, new Set());
  if (!matches) throw new Error('No valid topic pack (author would be a debater).');
  return { matches, usedPackIds: [...used0, ...matches.map((m) => m.packId)] };
}

function resetStageScores(ids: PlayerId[]): Record<PlayerId, number> {
  return Object.fromEntries(ids.map((id) => [id, 0]));
}

export function beginPairedStage(engine: Engine, rng: () => number = Math.random): Engine {
  const ids = sortIds(engine.activeIds);
  const kind = stageFor(ids.length);

  if (kind === 'final') {
    return beginFinalTopicCollection({ ...engine, stageKind: kind, scores: resetStageScores(ids) });
  }

  let pairs: [PlayerId, PlayerId][] = [];
  let leftover: PlayerId | null = null;

  if (kind === 'n6') {
    const p = pairN6(ids, rng);
    pairs = p.pairs;
    leftover = p.leftover;
  } else if (kind === 'n5' || kind === 'n4') {
    pairs = cyclePairs(shuffled(ids, rng));
  } else {
    pairs = rr3Pairs(shuffled(ids, rng));
  }

  const built = buildMatches(pairs, engine.packPool, engine.usedPackIds, rng, false);
  return startMatch({
    ...engine,
    stageKind: kind,
    leftoverId: leftover,
    leftoverPending: leftover != null,
    autoOutId: null,
    matches: built.matches,
    usedPackIds: built.usedPackIds,
    matchIndex: 0,
    scores: resetStageScores(ids),
    replayNote: null,
    ...emptyMatchInputs(),
  });
}

export function beginFinalTopicCollection(engine: Engine): Engine {
  return {
    ...engine,
    phase: 'collect_final_topics',
    stageKind: 'final',
    matches: [],
    matchIndex: 0,
    leftoverId: null,
    leftoverPending: false,
    autoOutId: null,
    topicVotes: {},
    finalPackIds: [],
    phaseEndsAtMs: null,
    turnIndex: 0,
    splitA: {},
    clapA: {},
    clapB: {},
    championId: null,
    replayNote: engine.lastDraw ? 'Final was a draw — new topic, same finalists.' : null,
  };
}

export function listenerPacks(engine: Engine): Pack[] {
  const allow = new Set(engine.finalPackIds);
  return engine.packPool.filter((p) => allow.has(p.id));
}

export function maybeLockFinalTopics(engine: Engine, roomPlayerIds: PlayerId[]): Engine {
  const packs = listenerPacks(engine);
  if (packs.length === 0) return engine;
  const listeners = roomPlayerIds.filter((id) => !engine.activeIds.includes(id));
  if (listeners.length <= 1 || packs.length === 1) {
    return startFinalWithPack(engine, packs[0]!.id);
  }
  return { ...engine, phase: 'vote_final_topic', splitA: {}, clapA: {}, clapB: {} };
}

export function voteFinalTopic(engine: Engine, voterId: PlayerId, packId: string): Engine {
  if (engine.phase !== 'vote_final_topic') return engine;
  if (engine.activeIds.includes(voterId)) return engine;
  if (!listenerPacks(engine).some((p) => p.id === packId)) return engine;
  return { ...engine, topicVotes: { ...engine.topicVotes, [voterId]: packId } };
}

export function allTopicVotesIn(engine: Engine, roomPlayerIds: PlayerId[]): boolean {
  const listeners = roomPlayerIds.filter((id) => !engine.activeIds.includes(id));
  if (listeners.length === 0) return false;
  return listeners.every((id) => !!engine.topicVotes[id]);
}

export function resolveFinalTopicVote(engine: Engine, rng: () => number = Math.random): Engine {
  const packs = listenerPacks(engine);
  if (packs.length === 0) return engine;
  const counts = new Map<string, number>();
  for (const pack of packs) counts.set(pack.id, 0);
  for (const packId of Object.values(engine.topicVotes)) {
    if (counts.has(packId)) counts.set(packId, (counts.get(packId) ?? 0) + 1);
  }
  let best = 0;
  for (const c of counts.values()) best = Math.max(best, c);
  const leaders = [...counts.entries()].filter(([, c]) => c === best).map(([id]) => id);
  const pick = leaders[Math.floor(rng() * leaders.length)] ?? packs[0]!.id;
  return startFinalWithPack(engine, pick, rng);
}

export function startFinalWithPack(engine: Engine, packId: string, rng: () => number = Math.random): Engine {
  const [aId, bId] = engine.activeIds;
  if (!aId || !bId) return engine;
  const match: Match = {
    aId,
    bId,
    packId,
    swapStances: rng() < 0.5,
    leftoverBonus: false,
  };
  return startMatch({
    ...engine,
    stageKind: 'final',
    matches: [match],
    usedPackIds: [...engine.usedPackIds, packId],
    matchIndex: 0,
    scores: resetStageScores(engine.activeIds),
    leftoverPending: false,
    leftoverId: null,
    ...emptyMatchInputs(),
  });
}

function startMatch(engine: Engine, now = Date.now()): Engine {
  const match = engine.matches[engine.matchIndex];
  if (!match) return finishStage(engine);
  return {
    ...engine,
    phase: 'prep',
    turnIndex: 0,
    phaseEndsAtMs: now + engine.settings.prepSeconds * 1000,
    lastDraw: false,
    lastPointsA: 0,
    lastPointsB: 0,
    ...emptyMatchInputs(),
  };
}

export function tickClock(engine: Engine, now = Date.now()): Engine {
  if (engine.phaseEndsAtMs == null || now < engine.phaseEndsAtMs) return engine;

  if (engine.phase === 'prep') {
    const totalMs = engine.settings.debateMinutes * 60 * 1000;
    const beat = engine.settings.speakMode === 'timed_turns' ? Math.floor(totalMs / 4) : totalMs;
    return {
      ...engine,
      phase: 'debate',
      turnIndex: 0,
      phaseEndsAtMs: now + beat,
    };
  }

  if (engine.phase === 'debate') {
    if (engine.settings.speakMode === 'timed_turns' && engine.turnIndex < 3) {
      const totalMs = engine.settings.debateMinutes * 60 * 1000;
      const beat = Math.floor(totalMs / 4);
      return { ...engine, turnIndex: engine.turnIndex + 1, phaseEndsAtMs: now + beat };
    }
    return { ...engine, phase: 'split_vote', phaseEndsAtMs: null };
  }

  return engine;
}

export function clap(
  engine: Engine,
  voterId: PlayerId,
  side: 'A' | 'B',
  roomPlayerIds: PlayerId[],
  now = Date.now(),
): Engine {
  if (engine.phase !== 'debate') return engine;
  if (!listenersOf(engine, roomPlayerIds).includes(voterId)) return engine;
  const last = engine.lastClapAt[voterId];
  if (last != null && now - last < CLAP_COOLDOWN_MS) return engine;
  const key = side === 'A' ? 'clapA' : 'clapB';
  return {
    ...engine,
    [key]: { ...engine[key], [voterId]: (engine[key][voterId] ?? 0) + 1 },
    lastClapAt: { ...engine.lastClapAt, [voterId]: now },
  };
}

export function submitSplit(engine: Engine, voterId: PlayerId, forA: number, roomPlayerIds: PlayerId[]): Engine {
  if (engine.phase !== 'split_vote') return engine;
  if (!listenersOf(engine, roomPlayerIds).includes(voterId)) return engine;
  if (engine.splitA[voterId] != null) return engine;
  const a = Math.max(0, Math.min(VOTE_POINTS, Math.round(forA)));
  return { ...engine, splitA: { ...engine.splitA, [voterId]: a } };
}

export function allSplitsIn(engine: Engine, roomPlayerIds: PlayerId[]): boolean {
  const voters = listenersOf(engine, roomPlayerIds);
  if (voters.length === 0) return false;
  return voters.every((id) => engine.splitA[id] != null);
}

export function matchPoints(engine: Engine, roomPlayerIds: PlayerId[]): { a: number; b: number } {
  const m = currentMatch(engine);
  if (!m) return { a: 0, b: 0 };
  const voters = listenersOf(engine, roomPlayerIds);
  let a = 0;
  let b = 0;
  for (const id of voters) {
    const split = engine.splitA[id];
    if (split != null) {
      a += split * TWENTIETHS_PER_VOTE;
      b += (VOTE_POINTS - split) * TWENTIETHS_PER_VOTE;
    }
    a += (engine.clapA[id] ?? 0) * CLAP_TWENTIETHS;
    b += (engine.clapB[id] ?? 0) * CLAP_TWENTIETHS;
  }
  if (m.leftoverBonus) {
    a += voters.length * TWENTIETHS_PER_VOTE;
  }
  return { a, b };
}

export function formatPoints(twentieths: number): string {
  const whole = twentieths / TWENTIETHS_PER_VOTE;
  return whole.toFixed(whole % 1 === 0 ? 0 : 2);
}

export function resolveSplit(engine: Engine, roomPlayerIds: PlayerId[]): Engine {
  if (engine.phase !== 'split_vote' || !allSplitsIn(engine, roomPlayerIds)) return engine;
  const m = currentMatch(engine);
  if (!m) return engine;
  const { a, b } = matchPoints(engine, roomPlayerIds);
  const draw = a === b;
  const scores = { ...engine.scores };
  scores[m.aId] = (scores[m.aId] ?? 0) + a;
  scores[m.bId] = (scores[m.bId] ?? 0) + b;
  return {
    ...engine,
    phase: 'match_result',
    scores,
    lastPointsA: a,
    lastPointsB: b,
    lastDraw: draw,
    phaseEndsAtMs: null,
  };
}

export function lowestDrop(ids: PlayerId[], scores: Record<PlayerId, number>, want: number): PlayerId[] {
  const unique = [...new Set(ids.map((id) => scores[id] ?? 0))].sort((x, y) => x - y);
  const drop: PlayerId[] = [];
  for (const sc of unique) {
    const group = ids.filter((id) => (scores[id] ?? 0) === sc);
    if (drop.length + group.length > want) break;
    drop.push(...group);
    if (drop.length >= want) break;
  }
  return drop;
}

function twoLowest(ids: PlayerId[], scores: Record<PlayerId, number>): PlayerId[] {
  const sorted = [...ids].sort((a, b) => (scores[a] ?? 0) - (scores[b] ?? 0) || a.localeCompare(b));
  return sorted.slice(0, 2);
}

function finishStage(engine: Engine): Engine {
  const kind = engine.stageKind;

  if (kind === 'final') {
    if (engine.lastDraw) return beginFinalTopicCollection(engine);
    const m = currentMatch(engine);
    const champ = m ? (engine.lastPointsA > engine.lastPointsB ? m.aId : m.bId) : (engine.activeIds[0] ?? null);
    return { ...engine, phase: 'champion', championId: champ, phaseEndsAtMs: null };
  }

  const want = kind === 'n3' ? 1 : 2;
  const drop = lowestDrop(engine.activeIds, engine.scores, want);
  if (drop.length === 0 || (kind === 'n3' && drop.length !== 1)) {
    return {
      ...engine,
      phase: 'collect_packs',
      matches: [],
      matchIndex: 0,
      leftoverPending: false,
      leftoverId: null,
      autoOutId: null,
      scores: resetStageScores(engine.activeIds),
      replayNote: 'Complete tie on the cutoff — that round is replayed.',
      ...emptyMatchInputs(),
    };
  }

  let remaining = engine.activeIds.filter((id) => !drop.includes(id));
  remaining = sortIds(remaining);
  const nextKind = stageFor(remaining.length);
  const nextPhase: Phase = nextKind === 'final' ? 'collect_final_topics' : 'collect_packs';
  return {
    ...engine,
    phase: nextPhase,
    stageKind: nextKind,
    activeIds: remaining,
    matches: [],
    matchIndex: 0,
    leftoverId: null,
    leftoverPending: false,
    autoOutId: null,
    scores: resetStageScores(remaining),
    replayNote: null,
    championId: null,
    ...emptyMatchInputs(),
  };
}

export function hostContinue(engine: Engine, roomPlayerIds: PlayerId[], rng: () => number = Math.random): Engine {
  if (engine.phase === 'match_result') {
    const m = currentMatch(engine);

    if (m?.leftoverBonus) {
      let remaining = [...engine.activeIds];
      const other = engine.autoOutId;
      if (other) remaining = remaining.filter((id) => id !== other);
      if (!engine.lastDraw && m) {
        const loser = engine.lastPointsA >= engine.lastPointsB ? m.bId : m.aId;
        remaining = remaining.filter((id) => id !== loser);
      }
      remaining = sortIds(remaining);
      const nextKind = stageFor(remaining.length);
      return {
        ...engine,
        phase: nextKind === 'final' ? 'collect_final_topics' : 'collect_packs',
        stageKind: nextKind,
        activeIds: remaining,
        matches: [],
        matchIndex: 0,
        leftoverId: null,
        leftoverPending: false,
        autoOutId: null,
        scores: resetStageScores(remaining),
        replayNote: null,
        ...emptyMatchInputs(),
      };
    }

    if (engine.stageKind === 'final' && engine.lastDraw) {
      return beginFinalTopicCollection(engine);
    }
    if (engine.stageKind === 'final') {
      return finishStage(engine);
    }

    const nextIndex = engine.matchIndex + 1;
    if (nextIndex < engine.matches.length) {
      return startMatch({ ...engine, matchIndex: nextIndex });
    }

    if (engine.leftoverPending && engine.leftoverId) {
      const played = engine.activeIds.filter((id) => id !== engine.leftoverId);
      const worst = twoLowest(played, engine.scores);
      const better = [...worst].sort((a, b) => (engine.scores[b] ?? 0) - (engine.scores[a] ?? 0) || a.localeCompare(b))[0]!;
      const other = worst.find((id) => id !== better) ?? worst[1]!;
      const assigned = assignPackToMatch(engine.leftoverId, better, engine.packPool, new Set(engine.usedPackIds), rng);
      const bonusMatch: Match = {
        aId: engine.leftoverId,
        bId: better,
        leftoverBonus: true,
        ...assigned,
      };
      return startMatch({
        ...engine,
        leftoverPending: false,
        autoOutId: other,
        matches: [...engine.matches, bonusMatch],
        usedPackIds: [...engine.usedPackIds, assigned.packId],
        matchIndex: engine.matches.length,
      });
    }

    return finishStage(engine);
  }

  if (engine.phase === 'collect_packs' && allRequiredPacksIn(engine)) {
    return beginPairedStage(engine, rng);
  }

  if (engine.phase === 'collect_final_topics') {
    return maybeLockFinalTopics(engine, roomPlayerIds);
  }

  if (engine.phase === 'vote_final_topic' && allTopicVotesIn(engine, roomPlayerIds)) {
    return resolveFinalTopicVote(engine, rng);
  }

  return engine;
}

export function parseEngine(raw: unknown, fallbackIds: PlayerId[]): Engine {
  const base = createEngine(fallbackIds);
  if (!raw || typeof raw !== 'object') return base;
  const s = raw as Engine;
  return {
    ...base,
    ...s,
    settings: parseSettings(s.settings),
    activeIds: Array.isArray(s.activeIds) ? s.activeIds : base.activeIds,
    packPool: Array.isArray(s.packPool) ? s.packPool : [],
    usedPackIds: Array.isArray(s.usedPackIds) ? s.usedPackIds : [],
    matches: Array.isArray(s.matches) ? s.matches : [],
    scores: s.scores && typeof s.scores === 'object' ? s.scores : base.scores,
    clapA: s.clapA && typeof s.clapA === 'object' ? s.clapA : {},
    clapB: s.clapB && typeof s.clapB === 'object' ? s.clapB : {},
    lastClapAt: s.lastClapAt && typeof s.lastClapAt === 'object' ? s.lastClapAt : {},
    splitA: s.splitA && typeof s.splitA === 'object' ? s.splitA : {},
    topicVotes: s.topicVotes && typeof s.topicVotes === 'object' ? s.topicVotes : {},
    finalPackIds: Array.isArray(s.finalPackIds) ? s.finalPackIds : [],
  };
}

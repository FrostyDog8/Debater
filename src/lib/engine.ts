export type PlayerId = string;

export const GAME_ID = 'debate-web';
export const MIN_START_PLAYERS = 3;
export const VOTE_POINTS = 10;
export const SCORE_SCALE = 10;
export const CLAP_SCORE = 1;
export const CLAP_COOLDOWN_MS = 2000;
export const MIN_TEXT = 1;

export function packTextReady(topic: string, stanceA: string, stanceB: string): boolean {
  return topic.trim().length >= MIN_TEXT && stanceA.trim().length >= MIN_TEXT && stanceB.trim().length >= MIN_TEXT;
}

export const PREP_MIN_SEC = 5;
export const PREP_STEP_SEC = 5;
export const PREP_MAX_SEC = 120;
export const DEBATE_MIN_SEC = 20;
export const DEBATE_STEP_SEC = 10;
export const DEBATE_MAX_SEC = 600;

export type SpeakMode = 'timed_turns' | 'free_for_all';

export type Settings = {
  prepSeconds: number;
  debateSeconds: number;
  speakMode: SpeakMode;
};

export const DEFAULT_SETTINGS: Settings = {
  prepSeconds: 30,
  debateSeconds: 120,
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

export type MatchHistoryEntry = {
  roundIndex: number;
  stageKind: StageKind;
  aId: PlayerId;
  bId: PlayerId;
  packId: string;
  swapStances: boolean;
  leftoverBonus: boolean;
  pointsA: number;
  pointsB: number;
  topic: string;
  stanceA: string;
  stanceB: string;
  authorId: PlayerId;
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
  /**
   * Pack ids that already existed when the current collect_packs phase began.
   * Leftovers stay in the pool for matchmaking, but only packs added after this
   * baseline count as “submitted this round.”
   */
  collectBaselinePackIds: string[];
  matches: Match[];
  matchIndex: number;
  /** Completed debates across the whole game, for the end summary. */
  matchHistory: MatchHistoryEntry[];
  /** Increments each paired stage / finals so summary can group rounds. */
  roundIndex: number;
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
  /** Winning finals topic after votes are in; prep waits for host Continue. */
  finalSelectedPackId: string | null;
  /** After finals score voting, host must reveal before draw/champion UI. */
  finalOutcomeRevealed: boolean;
  phaseEndsAtMs: number | null;
  /** When set, the clock is paused with this many ms left on the current beat. */
  pauseRemainingMs: number | null;
  turnIndex: number;
  lastPointsA: number;
  lastPointsB: number;
  lastDraw: boolean;
  championId: PlayerId | null;
  replayNote: string | null;
  /** Short host-driven status for guests (e.g. skipped to voting). */
  hostNotice: string | null;
};

export function stageFor(n: number): StageKind {
  if (n <= 2) return 'final';
  if (n === 3) return 'n3';
  if (n === 4) return 'n4';
  if (n === 5) return 'n5';
  return 'n6';
}

/** How many players this stage will eliminate (0 in finals). */
export function eliminationsThisStage(stageKind: StageKind): number {
  if (stageKind === 'final') return 0;
  if (stageKind === 'n3') return 1;
  return 2;
}

function snapRange(value: number, min: number, step: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  const snapped = Math.round(value / step) * step;
  return Math.max(min, Math.min(max, snapped));
}

export function parseSettings(raw: unknown): Settings {
  const r = (raw ?? {}) as Partial<Settings> & { debateMinutes?: number };
  const prep = snapRange(Number(r.prepSeconds) || DEFAULT_SETTINGS.prepSeconds, PREP_MIN_SEC, PREP_STEP_SEC, PREP_MAX_SEC);
  const debateRaw =
    Number(r.debateSeconds) ||
    (Number(r.debateMinutes) > 0 ? Number(r.debateMinutes) * 60 : DEFAULT_SETTINGS.debateSeconds);
  const debate = snapRange(debateRaw, DEBATE_MIN_SEC, DEBATE_STEP_SEC, DEBATE_MAX_SEC);
  const speakMode: SpeakMode = r.speakMode === 'free_for_all' ? 'free_for_all' : 'timed_turns';
  return { prepSeconds: prep, debateSeconds: debate, speakMode };
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
    collectBaselinePackIds: [],
    matches: [],
    matchIndex: 0,
    matchHistory: [],
    roundIndex: 0,
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
    finalSelectedPackId: null,
    finalOutcomeRevealed: false,
    phaseEndsAtMs: null,
    pauseRemainingMs: null,
    turnIndex: 0,
    lastPointsA: 0,
    lastPointsB: 0,
    lastDraw: false,
    championId: null,
    replayNote: null,
    hostNotice: null,
  };
}

/** Mark every existing pack as used so the next collect asks for fresh topics. */
export function markAllPacksUsed(engine: Engine): string[] {
  return engine.packPool.map((p) => p.id);
}

export function unusedPacks(engine: Engine): Pack[] {
  const used = new Set(engine.usedPackIds);
  return engine.packPool.filter((p) => !used.has(p.id));
}

export function hasUnusedPack(engine: Engine, authorId: PlayerId): boolean {
  return unusedPacks(engine).some((p) => p.authorId === authorId);
}

/** True if this author added a topic during the current collect phase. */
export function hasSubmittedThisCollect(engine: Engine, authorId: PlayerId): boolean {
  const baseline = new Set(engine.collectBaselinePackIds);
  return engine.packPool.some((p) => p.authorId === authorId && !baseline.has(p.id));
}

function withCollectBaseline(engine: Engine): Engine {
  return {
    ...engine,
    collectBaselinePackIds: engine.packPool.map((p) => p.id),
  };
}

export function playersNeedingPack(engine: Engine, roomPlayerIds: PlayerId[] = []): PlayerId[] {
  if (engine.phase === 'collect_final_topics') return [];
  if (engine.phase !== 'collect_packs') return [];
  const pool = roomPlayerIds.length > 0 ? roomPlayerIds : engine.activeIds;
  return pool.filter((id) => !hasSubmittedThisCollect(engine, id));
}

export function expectedPackAuthors(engine: Engine, roomPlayerIds: PlayerId[]): PlayerId[] {
  // Normal rounds: every player in the room submits a topic (including eliminated).
  if (engine.phase === 'collect_packs') return sortIds(roomPlayerIds);
  // Finals: only non-finalists submit.
  if (engine.phase === 'collect_final_topics') {
    return sortIds(roomPlayerIds.filter((id) => !engine.activeIds.includes(id)));
  }
  return [];
}

export function submittedPackAuthors(engine: Engine, roomPlayerIds: PlayerId[]): PlayerId[] {
  if (engine.phase === 'collect_packs') {
    return expectedPackAuthors(engine, roomPlayerIds).filter((id) => hasSubmittedThisCollect(engine, id));
  }
  if (engine.phase === 'collect_final_topics') {
    const allow = new Set(engine.finalPackIds);
    const authors = new Set(engine.packPool.filter((p) => allow.has(p.id)).map((p) => p.authorId));
    return expectedPackAuthors(engine, roomPlayerIds).filter((id) => authors.has(id));
  }
  return [];
}

export function packProgress(engine: Engine, roomPlayerIds: PlayerId[]): { have: number; need: number } {
  const need = expectedPackAuthors(engine, roomPlayerIds).length;
  const have = submittedPackAuthors(engine, roomPlayerIds).length;
  return { have, need };
}

export function currentMatch(engine: Engine): Match | null {
  return engine.matches[engine.matchIndex] ?? null;
}

export function peekNextMatch(engine: Engine): { aId: PlayerId; bId: PlayerId } | null {
  if (engine.phase !== 'match_result') return null;
  if (engine.stageKind === 'final') return null;
  const next = engine.matches[engine.matchIndex + 1];
  if (next) return { aId: next.aId, bId: next.bId };
  if (engine.leftoverPending && engine.leftoverId) {
    const played = engine.activeIds.filter((id) => id !== engine.leftoverId);
    const worst = twoLowest(played, engine.scores);
    const better = [...worst].sort((a, b) => (engine.scores[b] ?? 0) - (engine.scores[a] ?? 0) || a.localeCompare(b))[0];
    if (!better) return null;
    return { aId: engine.leftoverId, bId: better };
  }
  return null;
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

/** Stable id so retries / re-parses do not spawn duplicate archive rows. */
export function packIdFor(
  authorId: PlayerId,
  topic: string,
  stanceA: string,
  stanceB: string,
  salt = '',
): string {
  const payload = `${authorId}\n${topic}\n${stanceA}\n${stanceB}\n${salt}`;
  let h = 2166136261;
  for (let i = 0; i < payload.length; i++) {
    h ^= payload.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `pack_${authorId}_${(h >>> 0).toString(16)}`;
}

export function addPack(
  engine: Engine,
  authorId: PlayerId,
  entry: { topic: string; stanceA: string; stanceB: string },
  _rng: () => number = Math.random,
): Engine {
  const topic = entry.topic.trim();
  const stanceA = entry.stanceA.trim();
  const stanceB = entry.stanceB.trim();
  if (topic.length < 1 || stanceA.length < 1 || stanceB.length < 1) return engine;

  if (engine.phase === 'collect_packs') {
    if (hasSubmittedThisCollect(engine, authorId)) return engine;
  } else if (engine.phase === 'collect_final_topics') {
    if (engine.activeIds.includes(authorId)) return engine;
    if (engine.finalPackIds.some((fid) => engine.packPool.find((p) => p.id === fid)?.authorId === authorId)) {
      return engine;
    }
  } else {
    return engine;
  }

  // Salt by collect baseline so a leftover topic can be re-submitted as a fresh pack,
  // and finals topics do not collide with earlier-round ids.
  const salt = `${engine.phase}:${engine.roundIndex}:${engine.collectBaselinePackIds.length}`;
  const id = packIdFor(authorId, topic, stanceA, stanceB, salt);
  if (engine.packPool.some((p) => p.id === id)) {
    if (engine.phase === 'collect_final_topics' && !engine.finalPackIds.includes(id)) {
      return { ...engine, finalPackIds: [...engine.finalPackIds, id], replayNote: null };
    }
    return engine;
  }

  const pack: Pack = { id, authorId, topic, stanceA, stanceB };
  return {
    ...engine,
    packPool: [...engine.packPool, pack],
    finalPackIds: engine.phase === 'collect_final_topics' ? [...engine.finalPackIds, pack.id] : engine.finalPackIds,
    replayNote: null,
  };
}

export function allRequiredPacksIn(engine: Engine, roomPlayerIds: PlayerId[] = []): boolean {
  if (engine.phase === 'collect_packs') return playersNeedingPack(engine, roomPlayerIds).length === 0;
  if (engine.phase === 'collect_final_topics') {
    const expected = expectedPackAuthors(engine, roomPlayerIds);
    if (expected.length === 0) return listenerPacks(engine).length > 0;
    return submittedPackAuthors(engine, roomPlayerIds).length >= expected.length;
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
  let pairs: [PlayerId, PlayerId][] = [];
  for (let i = 0; i + 1 < work.length; i += 2) {
    const a = work[i]!;
    const b = work[i + 1]!;
    pairs.push(rng() < 0.5 ? [a, b] : [b, a]);
  }
  pairs = shuffled(pairs, rng);
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

/** Shuffle seats, build pairings, randomize sides, then shuffle debate order. */
function buildStagePairs(
  ids: PlayerId[],
  kind: StageKind,
  rng: () => number,
): { pairs: [PlayerId, PlayerId][]; leftover: PlayerId | null } {
  if (kind === 'n6') return pairN6(ids, rng);

  const order = shuffled(ids, rng);
  let pairs: [PlayerId, PlayerId][] = kind === 'n3' ? rr3Pairs(order) : cyclePairs(order);
  pairs = pairs.map(([a, b]) => (rng() < 0.5 ? [a, b] : [b, a]));
  pairs = shuffled(pairs, rng);
  return { pairs, leftover: null };
}

/** First pair to debate once the round is ready (or finalists). */
export function openingDebatePair(engine: Engine): { aId: PlayerId; bId: PlayerId } | null {
  if (engine.phase === 'collect_packs') {
    const m = engine.matches[0];
    return m ? { aId: m.aId, bId: m.bId } : null;
  }
  if (
    (engine.phase === 'collect_final_topics' || engine.phase === 'vote_final_topic') &&
    engine.activeIds.length >= 2
  ) {
    return { aId: engine.activeIds[0]!, bId: engine.activeIds[1]! };
  }
  return null;
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

/**
 * Lock in pairings while still on collect_packs so the UI can show who debates first
 * before the host presses Play round.
 */
export function schedulePairedStage(engine: Engine, rng: () => number = Math.random): Engine {
  if (engine.phase !== 'collect_packs') return engine;
  if (engine.matches.length > 0) return engine;

  const ids = sortIds(engine.activeIds);
  const kind = stageFor(ids.length);

  if (kind === 'final') {
    return beginFinalTopicCollection({ ...engine, stageKind: kind, scores: resetStageScores(ids) });
  }

  const { pairs, leftover } = buildStagePairs(ids, kind, rng);
  const built = buildMatches(pairs, engine.packPool, engine.usedPackIds, rng, false);
  const nextRound =
    engine.matchHistory.length === 0
      ? 0
      : Math.max(...engine.matchHistory.map((h) => h.roundIndex)) + 1;
  return {
    ...engine,
    phase: 'collect_packs',
    stageKind: kind,
    leftoverId: leftover,
    leftoverPending: leftover != null,
    autoOutId: null,
    matches: built.matches,
    usedPackIds: built.usedPackIds,
    matchIndex: 0,
    roundIndex: nextRound,
    scores: resetStageScores(ids),
    replayNote: null,
    ...emptyMatchInputs(),
  };
}

export function beginPairedStage(engine: Engine, rng: () => number = Math.random): Engine {
  const scheduled = schedulePairedStage(engine, rng);
  if (scheduled.phase !== 'collect_packs') return scheduled;
  return startMatch(scheduled);
}

export function beginFinalTopicCollection(engine: Engine): Engine {
  const ids = sortIds(engine.activeIds);
  const nextRound =
    engine.matchHistory.length === 0
      ? 0
      : Math.max(...engine.matchHistory.map((h) => h.roundIndex)) + 1;
  return {
    ...engine,
    phase: 'collect_final_topics',
    stageKind: 'final',
    activeIds: ids,
    matches: [],
    matchIndex: 0,
    roundIndex: nextRound,
    leftoverId: null,
    leftoverPending: false,
    autoOutId: null,
    topicVotes: {},
    finalPackIds: [],
    usedPackIds: engine.packPool.map((p) => p.id),
    collectBaselinePackIds: engine.packPool.map((p) => p.id),
    finalSelectedPackId: null,
    finalOutcomeRevealed: false,
    scores: resetStageScores(ids),
    lastPointsA: 0,
    lastPointsB: 0,
    lastDraw: engine.lastDraw && engine.stageKind === 'final',
    phaseEndsAtMs: null,
    pauseRemainingMs: null,
    turnIndex: 0,
    splitA: {},
    clapA: {},
    clapB: {},
    lastClapAt: {},
    championId: null,
    replayNote: engine.stageKind === 'final' && engine.lastDraw ? 'Final was a draw — new topic, same finalists.' : null,
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
    // No vote needed — lock the only option and wait for the host to start.
    return {
      ...engine,
      phase: 'vote_final_topic',
      topicVotes: {},
      finalSelectedPackId: packs[0]!.id,
      splitA: {},
      clapA: {},
      clapB: {},
    };
  }
  return {
    ...engine,
    phase: 'vote_final_topic',
    topicVotes: {},
    finalSelectedPackId: null,
    splitA: {},
    clapA: {},
    clapB: {},
  };
}

export function voteFinalTopic(engine: Engine, voterId: PlayerId, packId: string): Engine {
  if (engine.phase !== 'vote_final_topic') return engine;
  if (engine.activeIds.includes(voterId)) return engine;
  if (engine.finalSelectedPackId) return engine;
  if (!listenerPacks(engine).some((p) => p.id === packId)) return engine;
  return { ...engine, topicVotes: { ...engine.topicVotes, [voterId]: packId } };
}

export function allTopicVotesIn(engine: Engine, roomPlayerIds: PlayerId[]): boolean {
  const listeners = roomPlayerIds.filter((id) => !engine.activeIds.includes(id));
  if (listeners.length === 0) return false;
  return listeners.every((id) => !!engine.topicVotes[id]);
}

/** Majority / tie-break pick for the finals topic (does not start the match). */
export function pickFinalTopicPackId(engine: Engine): string | null {
  const packs = listenerPacks(engine);
  if (packs.length === 0) return null;
  const counts = new Map<string, number>();
  for (const pack of packs) counts.set(pack.id, 0);
  for (const packId of Object.values(engine.topicVotes)) {
    if (counts.has(packId)) counts.set(packId, (counts.get(packId) ?? 0) + 1);
  }
  let best = -1;
  for (const c of counts.values()) best = Math.max(best, c);
  const leaders = [...counts.entries()]
    .filter(([, c]) => c === best)
    .map(([id]) => id)
    .sort();
  return leaders[0] ?? packs[0]!.id;
}

/** When every listener has voted, lock the winning topic and wait for the host. */
export function lockFinalTopicPick(engine: Engine, roomPlayerIds: PlayerId[]): Engine {
  if (engine.phase !== 'vote_final_topic') return engine;
  if (engine.finalSelectedPackId) return engine;
  if (!allTopicVotesIn(engine, roomPlayerIds)) return engine;
  const pick = pickFinalTopicPackId(engine);
  if (!pick) return engine;
  return { ...engine, finalSelectedPackId: pick };
}

export function resolveFinalTopicVote(engine: Engine, rng: () => number = Math.random): Engine {
  const pick = engine.finalSelectedPackId ?? pickFinalTopicPackId(engine);
  if (!pick) return engine;
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
    finalSelectedPackId: packId,
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
    pauseRemainingMs: null,
    hostNotice: null,
    lastDraw: false,
    lastPointsA: 0,
    lastPointsB: 0,
    finalOutcomeRevealed: false,
    ...emptyMatchInputs(),
  };
}

export function isPaused(engine: Engine): boolean {
  return engine.pauseRemainingMs != null;
}

export function hostPause(engine: Engine, now = Date.now()): Engine {
  if (engine.phase !== 'prep' && engine.phase !== 'debate') return engine;
  if (engine.pauseRemainingMs != null) return engine;
  if (engine.phaseEndsAtMs == null) return engine;
  return {
    ...engine,
    pauseRemainingMs: Math.max(0, engine.phaseEndsAtMs - now),
    phaseEndsAtMs: null,
  };
}

export function hostUnpause(engine: Engine, now = Date.now()): Engine {
  if (engine.pauseRemainingMs == null) return engine;
  if (engine.phase !== 'prep' && engine.phase !== 'debate') {
    return { ...engine, pauseRemainingMs: null };
  }
  return {
    ...engine,
    phaseEndsAtMs: now + engine.pauseRemainingMs,
    pauseRemainingMs: null,
  };
}

export function hostSkipDebate(engine: Engine): Engine {
  if (engine.phase !== 'prep' && engine.phase !== 'debate') return engine;
  return {
    ...engine,
    phase: 'split_vote',
    phaseEndsAtMs: null,
    pauseRemainingMs: null,
    splitA: {},
    hostNotice: 'Host skipped to voting',
  };
}

export function canSkipRestOfRound(engine: Engine): boolean {
  return (
    engine.matches.length > 0 &&
    (engine.phase === 'prep' ||
      engine.phase === 'debate' ||
      engine.phase === 'split_vote' ||
      engine.phase === 'match_result')
  );
}

function fillRandomListenerOutcome(engine: Engine, roomPlayerIds: PlayerId[], rng: () => number): Engine {
  const listeners = listenersOf(engine, roomPlayerIds);
  const clapA = { ...engine.clapA };
  const clapB = { ...engine.clapB };
  const splitA = { ...engine.splitA };
  for (const id of listeners) {
    splitA[id] = Math.floor(rng() * (VOTE_POINTS + 1));
    clapA[id] = Math.floor(rng() * 10);
    clapB[id] = Math.floor(rng() * 10);
  }
  return { ...engine, clapA, clapB, splitA, pauseRemainingMs: null, phaseEndsAtMs: null };
}

/** Fast-forward the current stage to the result screen of its last debate. */
export function skipRestOfRound(
  engine: Engine,
  roomPlayerIds: PlayerId[],
  rng: () => number = Math.random,
): Engine {
  if (!canSkipRestOfRound(engine)) return engine;
  let e: Engine = { ...engine, pauseRemainingMs: null };
  for (let guard = 0; guard < 64; guard++) {
    if (e.phase === 'prep' || e.phase === 'debate') {
      e = hostSkipDebate(e);
      continue;
    }
    if (e.phase === 'split_vote') {
      e = fillRandomListenerOutcome(e, roomPlayerIds, rng);
      e = resolveSplit(e, roomPlayerIds);
      continue;
    }
    if (e.phase === 'match_result') {
      const match = currentMatch(e);
      const hasQueuedMatch = e.matchIndex + 1 < e.matches.length;
      const hasLeftover = !!(e.leftoverPending && e.leftoverId);
      // Stop on the last result of this round (including leftover-bonus finals of the stage).
      if (match?.leftoverBonus || (!hasQueuedMatch && !hasLeftover)) return e;
      e = hostContinue(e, roomPlayerIds, rng);
      if (e.phase === 'collect_packs' || e.phase === 'collect_final_topics' || e.phase === 'champion') {
        // Safety: never advance past the round boundary.
        return engine;
      }
      continue;
    }
    return e;
  }
  return e;
}

export function tickClock(engine: Engine, now = Date.now()): Engine {
  if (engine.pauseRemainingMs != null) return engine;
  if (engine.phaseEndsAtMs == null || now < engine.phaseEndsAtMs) return engine;

  if (engine.phase === 'prep') {
    const totalMs = engine.settings.debateSeconds * 1000;
    const beat = engine.settings.speakMode === 'timed_turns' ? Math.floor(totalMs / 4) : totalMs;
    return {
      ...engine,
      phase: 'debate',
      turnIndex: 0,
      phaseEndsAtMs: now + beat,
      pauseRemainingMs: null,
    };
  }

  if (engine.phase === 'debate') {
    if (engine.settings.speakMode === 'timed_turns' && engine.turnIndex < 3) {
      const totalMs = engine.settings.debateSeconds * 1000;
      const beat = Math.floor(totalMs / 4);
      return { ...engine, turnIndex: engine.turnIndex + 1, phaseEndsAtMs: now + beat, pauseRemainingMs: null };
    }
    return { ...engine, phase: 'split_vote', phaseEndsAtMs: null, pauseRemainingMs: null, splitA: {} };
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
  if (engine.pauseRemainingMs != null) return engine;
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

export function splitVoteProgress(engine: Engine, roomPlayerIds: PlayerId[]): { have: number; need: number } {
  const voters = listenersOf(engine, roomPlayerIds);
  return {
    have: voters.filter((id) => engine.splitA[id] != null).length,
    need: voters.length,
  };
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
      a += split * SCORE_SCALE;
      b += (VOTE_POINTS - split) * SCORE_SCALE;
    }
    a += (engine.clapA[id] ?? 0) * CLAP_SCORE;
    b += (engine.clapB[id] ?? 0) * CLAP_SCORE;
  }
  if (m.leftoverBonus) {
    a += voters.length * SCORE_SCALE;
  }
  return { a, b };
}

export function formatPoints(units: number): string {
  const whole = units / SCORE_SCALE;
  return whole.toFixed(whole % 1 === 0 ? 0 : 1);
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
  const pack = engine.packPool.find((p) => p.id === m.packId);
  const entry: MatchHistoryEntry = {
    roundIndex: engine.roundIndex,
    stageKind: engine.stageKind,
    aId: m.aId,
    bId: m.bId,
    packId: m.packId,
    swapStances: m.swapStances,
    leftoverBonus: m.leftoverBonus,
    pointsA: a,
    pointsB: b,
    topic: pack?.topic ?? '',
    stanceA: pack ? (m.swapStances ? pack.stanceB : pack.stanceA) : '',
    stanceB: pack ? (m.swapStances ? pack.stanceA : pack.stanceB) : '',
    authorId: pack?.authorId ?? '',
  };
  return {
    ...engine,
    phase: 'match_result',
    scores,
    lastPointsA: a,
    lastPointsB: b,
    lastDraw: draw,
    phaseEndsAtMs: null,
    hostNotice: null,
    finalOutcomeRevealed: false,
    matchHistory: [...engine.matchHistory, entry],
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
    return { ...engine, phase: 'champion', championId: champ, phaseEndsAtMs: null, pauseRemainingMs: null };
  }

  const want = kind === 'n3' ? 1 : 2;
  const drop = lowestDrop(engine.activeIds, engine.scores, want);
  if (drop.length === 0 || (kind === 'n3' && drop.length !== 1)) {
    return withCollectBaseline({
      ...engine,
      phase: 'collect_packs',
      // Keep usedPackIds as-is so unused leftover topics stay available.
      matches: [],
      matchIndex: 0,
      leftoverPending: false,
      leftoverId: null,
      autoOutId: null,
      scores: resetStageScores(engine.activeIds),
      replayNote: 'Complete tie on the cutoff — that round is replayed.',
      pauseRemainingMs: null,
      ...emptyMatchInputs(),
    });
  }

  let remaining = engine.activeIds.filter((id) => !drop.includes(id));
  remaining = sortIds(remaining);
  const nextKind = stageFor(remaining.length);
  if (nextKind === 'final') {
    // Finals: retire every existing topic, then listeners submit fresh ones.
    return beginFinalTopicCollection({ ...engine, activeIds: remaining });
  }
  return withCollectBaseline({
    ...engine,
    phase: 'collect_packs',
    stageKind: nextKind,
    activeIds: remaining,
    // Do not mark leftovers used — next round can consume unused packs.
    matches: [],
    matchIndex: 0,
    leftoverId: null,
    leftoverPending: false,
    autoOutId: null,
    scores: resetStageScores(remaining),
    replayNote: null,
    championId: null,
    pauseRemainingMs: null,
    ...emptyMatchInputs(),
  });
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
      if (stageFor(remaining.length) === 'final') {
        return beginFinalTopicCollection({ ...engine, activeIds: remaining });
      }
      return withCollectBaseline({
        ...engine,
        phase: 'collect_packs',
        stageKind: stageFor(remaining.length),
        activeIds: remaining,
        matches: [],
        matchIndex: 0,
        leftoverId: null,
        leftoverPending: false,
        autoOutId: null,
        scores: resetStageScores(remaining),
        replayNote: null,
        pauseRemainingMs: null,
        ...emptyMatchInputs(),
      });
    }

    if (engine.stageKind === 'final' && engine.lastDraw) {
      if (!engine.finalOutcomeRevealed) {
        return { ...engine, finalOutcomeRevealed: true };
      }
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

  if (engine.phase === 'collect_packs' && allRequiredPacksIn(engine, roomPlayerIds)) {
    if (engine.matches.length > 0) return startMatch(engine);
    return beginPairedStage(engine, rng);
  }

  if (engine.phase === 'collect_final_topics' && allRequiredPacksIn(engine, roomPlayerIds)) {
    return maybeLockFinalTopics(engine, roomPlayerIds);
  }

  if (engine.phase === 'vote_final_topic') {
    if (engine.finalSelectedPackId) {
      return resolveFinalTopicVote(engine, rng);
    }
    if (allTopicVotesIn(engine, roomPlayerIds)) {
      return resolveFinalTopicVote(lockFinalTopicPick(engine, roomPlayerIds), rng);
    }
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
    collectBaselinePackIds: Array.isArray(s.collectBaselinePackIds) ? s.collectBaselinePackIds : [],
    matches: Array.isArray(s.matches) ? s.matches : [],
    matchHistory: Array.isArray(s.matchHistory) ? s.matchHistory : [],
    roundIndex: typeof s.roundIndex === 'number' ? s.roundIndex : 0,
    scores: s.scores && typeof s.scores === 'object' ? s.scores : base.scores,
    clapA: s.clapA && typeof s.clapA === 'object' ? s.clapA : {},
    clapB: s.clapB && typeof s.clapB === 'object' ? s.clapB : {},
    lastClapAt: s.lastClapAt && typeof s.lastClapAt === 'object' ? s.lastClapAt : {},
    splitA: s.splitA && typeof s.splitA === 'object' ? s.splitA : {},
    topicVotes: s.topicVotes && typeof s.topicVotes === 'object' ? s.topicVotes : {},
    finalPackIds: Array.isArray(s.finalPackIds) ? s.finalPackIds : [],
    finalSelectedPackId: typeof s.finalSelectedPackId === 'string' ? s.finalSelectedPackId : null,
    finalOutcomeRevealed: !!s.finalOutcomeRevealed,
    pauseRemainingMs: typeof s.pauseRemainingMs === 'number' ? s.pauseRemainingMs : null,
    hostNotice: typeof s.hostNotice === 'string' ? s.hostNotice : null,
  };
}

import { describe, expect, it } from 'vitest';
import {
  addPack,
  beginPairedStage,
  clap,
  CLAP_COOLDOWN_MS,
  createEngine,
  currentMatch,
  currentPack,
  beginFinalTopicCollection,
  hostContinue,
  hostPause,
  hostSkipDebate,
  hostUnpause,
  isPaused,
  listenerPacks,
  lowestDrop,
  matchPoints,
  packProgress,
  parseSettings,
  playersNeedingPack,
  skipRestOfRound,
  stageFor,
  submitSplit,
  tickClock,
  unusedPacks,
  VOTE_POINTS,
  SCORE_SCALE,
  listenersOf,
  formatPoints,
  resolveSplit,
} from './engine';

function rng(seed = 1): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function fillPacks(ids: string[], r: () => number) {
  let e = createEngine(ids);
  for (const id of ids) {
    e = addPack(e, id, { topic: `Topic for ${id} xx`, stanceA: 'Yes we should.', stanceB: 'No we should not.' }, r);
  }
  return e;
}

describe('stageFor', () => {
  it('maps table sizes', () => {
    expect(stageFor(7)).toBe('n6');
    expect(stageFor(5)).toBe('n5');
    expect(stageFor(4)).toBe('n4');
    expect(stageFor(3)).toBe('n3');
    expect(stageFor(2)).toBe('final');
  });
});

describe('pairings', () => {
  it('never assigns a debater their own pack (3-player)', () => {
    const ids = ['p1', 'p2', 'p3'];
    const e0 = fillPacks(ids, rng(4));
    const e = beginPairedStage(e0, rng(4));
    expect(e.matches).toHaveLength(3);
    for (const m of e.matches) {
      const pack = e.packPool.find((p) => p.id === m.packId)!;
      expect(pack.authorId).not.toBe(m.aId);
      expect(pack.authorId).not.toBe(m.bId);
    }
  });

  it('gives each of 4 players two games against different opponents', () => {
    const ids = ['a', 'b', 'c', 'd'];
    const e = beginPairedStage(fillPacks(ids, rng(9)), rng(9));
    expect(e.matches).toHaveLength(4);
    const faced: Record<string, string[]> = { a: [], b: [], c: [], d: [] };
    for (const m of e.matches) {
      faced[m.aId]!.push(m.bId);
      faced[m.bId]!.push(m.aId);
    }
    for (const id of ids) {
      expect(new Set(faced[id]).size).toBe(2);
    }
  });

  it('gives each of 5 players two games', () => {
    const ids = ['a', 'b', 'c', 'd', 'e'];
    const e = beginPairedStage(fillPacks(ids, rng(2)), rng(2));
    expect(e.matches).toHaveLength(5);
    const count: Record<string, number> = {};
    for (const m of e.matches) {
      count[m.aId] = (count[m.aId] ?? 0) + 1;
      count[m.bId] = (count[m.bId] ?? 0) + 1;
    }
    for (const id of ids) expect(count[id]).toBe(2);
  });

  it('shuffles seat order so pairings are not fixed by player id sort', () => {
    const ids = ['a', 'b', 'c', 'd'];
    const orders = new Set<string>();
    for (let seed = 0; seed < 40; seed++) {
      const e = beginPairedStage(fillPacks(ids, rng(seed)), rng(seed));
      orders.add(e.matches.map((m) => `${m.aId}-${m.bId}`).join('|'));
    }
    expect(orders.size).toBeGreaterThan(1);
  });
});

describe('lowestDrop', () => {
  it('drops two strictly lowest', () => {
    const ids = ['a', 'b', 'c', 'd', 'e'];
    const scores = { a: 100, b: 80, c: 50, d: 20, e: 10 };
    expect(lowestDrop(ids, scores, 2).sort()).toEqual(['d', 'e']);
  });

  it('does not split a tied bubble', () => {
    const ids = ['a', 'b', 'c', 'd', 'e'];
    const scores = { a: 100, b: 50, c: 50, d: 50, e: 10 };
    expect(lowestDrop(ids, scores, 2)).toEqual(['e']);
  });

  it('drops nobody when the whole bottom is one tie', () => {
    const ids = ['a', 'b', 'c', 'd'];
    const scores = { a: 40, b: 40, c: 40, d: 40 };
    expect(lowestDrop(ids, scores, 2)).toEqual([]);
  });
});

describe('scoring', () => {
  it('counts a 10-point split and claps as 0.1 each', () => {
    const ids = ['a', 'b', 'c'];
    let e = beginPairedStage(fillPacks(ids, rng(1)), rng(1));
    const m = currentMatch(e)!;
    const room = ids;
    const listeners = listenersOf(e, room);
    expect(listeners.length).toBe(1);
    const voter = listeners[0]!;
    e = { ...e, phase: 'debate' };
    e = clap(e, voter, 'A', room, 1_000);
    e = clap(e, voter, 'A', room, 1_000 + CLAP_COOLDOWN_MS + 1);
    e = { ...e, phase: 'split_vote' };
    e = submitSplit(e, voter, 8, room);
    const pts = matchPoints(e, room);
    expect(pts.a).toBe(8 * SCORE_SCALE + 2);
    expect(pts.b).toBe((VOTE_POINTS - 8) * SCORE_SCALE);
    expect(currentPack(e)?.authorId).not.toBe(m.aId);
  });

  it('adds leftover bonus of +1 vote per listener', () => {
    const ids = ['a', 'b', 'c', 'd'];
    let e = fillPacks(ids, rng(3));
    const pack = e.packPool.find((p) => p.authorId === 'c' || p.authorId === 'd')!;
    e = {
      ...e,
      phase: 'split_vote',
      matches: [{ aId: 'a', bId: 'b', packId: pack.id, leftoverBonus: true, swapStances: false }],
      matchIndex: 0,
    };
    const listeners = listenersOf(e, ids);
    for (const v of listeners) e = submitSplit(e, v, 6, ids);
    const pts = matchPoints(e, ids);
    expect(pts.a).toBe(listeners.length * 6 * SCORE_SCALE + listeners.length * SCORE_SCALE);
  });

  it('formats scaled units without showing ×10 raw scores', () => {
    expect(formatPoints(50)).toBe('5');
    expect(formatPoints(55)).toBe('5.5');
  });

  it('appends match history on resolveSplit', () => {
    const ids = ['a', 'b', 'c'];
    let e = beginPairedStage(fillPacks(ids, rng(1)), rng(1));
    e = { ...e, phase: 'split_vote', roundIndex: 0 };
    const voter = listenersOf(e, ids)[0]!;
    e = submitSplit(e, voter, 7, ids);
    e = resolveSplit(e, ids);
    expect(e.matchHistory).toHaveLength(1);
    expect(e.matchHistory[0]!.pointsA).toBe(7 * SCORE_SCALE);
    expect(formatPoints(e.matchHistory[0]!.pointsA)).toBe('7');
  });
});

describe('clock', () => {
  it('moves prep to debate then to vote', () => {
    const ids = ['a', 'b', 'c'];
    let e = beginPairedStage(fillPacks(ids, rng(5)), rng(5));
    expect(e.phase).toBe('prep');
    e = tickClock(e, (e.phaseEndsAtMs ?? 0) + 1);
    expect(e.phase).toBe('debate');
    e = { ...e, settings: { ...e.settings, speakMode: 'free_for_all' } };
    e = tickClock(e, (e.phaseEndsAtMs ?? 0) + 1);
    expect(e.phase).toBe('split_vote');
  });
});

describe('finals', () => {
  it('empties the old topic pool and resets scores', () => {
    const ids = ['a', 'b', 'c'];
    let e = beginPairedStage(fillPacks(ids, rng(1)), rng(1));
    e = { ...e, scores: { a: 50, b: 40, c: 10 } };
    e = beginFinalTopicCollection({ ...e, activeIds: ['a', 'b'] });
    expect(e.phase).toBe('collect_final_topics');
    expect(e.stageKind).toBe('final');
    expect(e.usedPackIds.sort()).toEqual(e.packPool.map((p) => p.id).sort());
    expect(e.finalPackIds).toEqual([]);
    expect(e.scores).toEqual({ a: 0, b: 0 });
    expect(listenerPacks(e)).toEqual([]);
  });

  it('resets scores when a paired round starts', () => {
    const ids = ['a', 'b', 'c'];
    let e = fillPacks(ids, rng(6));
    e = { ...e, scores: { a: 99, b: 88, c: 77 } };
    e = beginPairedStage(e, rng(6));
    expect(e.scores).toEqual({ a: 0, b: 0, c: 0 });
  });
});

describe('clock leftovers', () => {
  it('clears leftover split votes when debate ends', () => {
    const ids = ['a', 'b', 'c'];
    let e = beginPairedStage(fillPacks(ids, rng(5)), rng(5));
    e = {
      ...e,
      phase: 'debate',
      splitA: { c: 8 },
      phaseEndsAtMs: 1,
      settings: { ...e.settings, speakMode: 'free_for_all' },
    };
    e = tickClock(e, 2);
    expect(e.phase).toBe('split_vote');
    expect(e.splitA).toEqual({});
  });
});

describe('round topic leftovers', () => {
  it('keeps unused topics after a cut and asks every room player for topics', () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
    let e = fillPacks(ids, rng(11));
    const byAuthor = Object.fromEntries(e.packPool.map((p) => [p.authorId, p.id]));
    // Three matches consumed d/e/f packs; a/b/c leftovers remain for survivors.
    e = {
      ...e,
      phase: 'match_result',
      stageKind: 'n6',
      usedPackIds: [byAuthor.d!, byAuthor.e!, byAuthor.f!],
      matches: [
        { aId: 'a', bId: 'b', packId: byAuthor.d!, swapStances: false, leftoverBonus: false },
        { aId: 'c', bId: 'd', packId: byAuthor.e!, swapStances: false, leftoverBonus: false },
        { aId: 'e', bId: 'f', packId: byAuthor.f!, swapStances: false, leftoverBonus: false },
      ],
      matchIndex: 2,
      leftoverPending: false,
      leftoverId: null,
      scores: { a: 50, b: 40, c: 30, d: 20, e: 5, f: 1 },
      lastDraw: false,
    };
    e = hostContinue(e, ids);
    expect(e.phase).toBe('collect_packs');
    expect(e.activeIds).toEqual(['a', 'b', 'c', 'd']);
    // Leftover unused packs stay available (a/b/c still have unused topics).
    expect(unusedPacks(e).map((p) => p.authorId).sort()).toEqual(['a', 'b', 'c']);
    // Everyone in the room is asked; a/b/c already have unused packs.
    expect(packProgress(e, ids)).toEqual({ have: 3, need: 6 });
    expect(playersNeedingPack(e, ids).sort()).toEqual(['d', 'e', 'f']);
  });

  it('marks every topic used only when entering finals', () => {
    const ids = ['a', 'b', 'c'];
    let e = beginPairedStage(fillPacks(ids, rng(4)), rng(4));
    const poolIds = e.packPool.map((p) => p.id);
    e = beginFinalTopicCollection({ ...e, activeIds: ['a', 'b'] });
    expect(e.usedPackIds.sort()).toEqual(poolIds.sort());
    expect(unusedPacks(e)).toEqual([]);
  });
});

describe('host pause and skip', () => {
  it('pauses and resumes the debate timer', () => {
    const ids = ['a', 'b', 'c'];
    let e = beginPairedStage(fillPacks(ids, rng(8)), rng(8));
    e = tickClock(e, (e.phaseEndsAtMs ?? 0) + 1);
    expect(e.phase).toBe('debate');
    const ends = e.phaseEndsAtMs!;
    e = hostPause(e, ends - 4000);
    expect(isPaused(e)).toBe(true);
    expect(e.pauseRemainingMs).toBe(4000);
    expect(e.phaseEndsAtMs).toBeNull();
    e = tickClock(e, ends + 99999);
    expect(e.phase).toBe('debate');
    e = hostUnpause(e, 100_000);
    expect(isPaused(e)).toBe(false);
    expect(e.phaseEndsAtMs).toBe(104_000);
  });

  it('skips prep/debate straight into voting', () => {
    const ids = ['a', 'b', 'c'];
    let e = beginPairedStage(fillPacks(ids, rng(3)), rng(3));
    e = hostSkipDebate(e);
    expect(e.phase).toBe('split_vote');
    expect(e.phaseEndsAtMs).toBeNull();
    expect(e.pauseRemainingMs).toBeNull();
    expect(e.hostNotice).toBe('Host skipped to voting');
  });

  it('fast-forwards the rest of a round to the final match result', () => {
    const ids = ['a', 'b', 'c', 'd'];
    let e = beginPairedStage(fillPacks(ids, rng(7)), rng(7));
    expect(e.phase).toBe('prep');
    expect(e.matches.length).toBeGreaterThan(1);
    e = skipRestOfRound(e, ids, rng(7));
    expect(e.phase).toBe('match_result');
    expect(e.matchIndex).toBe(e.matches.length - 1);
    expect(e.leftoverPending).toBe(false);
  });
});

describe('packs', () => {
  it('rejects a topic with empty stances', () => {
    const ids = ['a', 'b', 'c'];
    let e = createEngine(ids);
    e = addPack(e, 'a', { topic: 'Cats vs dogs xx', stanceA: '', stanceB: '' });
    expect(e.packPool).toEqual([]);
    e = addPack(e, 'a', { topic: 'Cats vs dogs xx', stanceA: 'Cats are better.', stanceB: 'Dogs are better.' });
    expect(e.packPool).toHaveLength(1);
  });
});

describe('parseSettings', () => {
  it('snaps prep by 5s and debate by 10s', () => {
    expect(parseSettings({ prepSeconds: 7, debateSeconds: 24 })).toEqual({
      prepSeconds: 5,
      debateSeconds: 20,
      speakMode: 'timed_turns',
    });
    expect(parseSettings({ prepSeconds: 12, debateSeconds: 55 }).prepSeconds).toBe(10);
    expect(parseSettings({ prepSeconds: 12, debateSeconds: 55 }).debateSeconds).toBe(60);
  });

  it('reads old debateMinutes as seconds', () => {
    expect(parseSettings({ debateMinutes: 2 }).debateSeconds).toBe(120);
  });
});

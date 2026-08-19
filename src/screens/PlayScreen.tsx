import { useEffect, useMemo, useState } from 'react';
import {
  allRequiredPacksIn,
  CLAP_COOLDOWN_MS,
  VOTE_POINTS,
  currentDebaters,
  currentMatch,
  currentPack,
  formatPoints,
  listenerPacks,
  listenersOf,
  packProgress,
  packTextReady,
  peekNextMatch,
  hasUnusedPack,
  stancesFor,
  turnLabel,
  whoseTurn,
  type Engine,
} from '../lib/engine';
import { ClapBursts, useClapBursts } from '../components/ClapBursts';
import type { PlayerInput } from '../lib/sync';
import type { Room } from '../lib/session';

type Props = {
  room: Room;
  selfId: string;
  engine: Engine;
  input: PlayerInput;
  error: string | null;
  now: number;
  onInput(next: PlayerInput): void;
  onHostContinue(): void;
  onLeave(): void;
  onPlayAgain(): void;
};

function nameOf(room: Room, id: string): string {
  return room.players.find((p) => p.id === id)?.name ?? id.slice(0, 6);
}

function remaining(ends: number | null, now: number): string {
  if (ends == null) return '';
  const s = Math.max(0, Math.ceil((ends - now) / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, '0')}`;
}

function clapSum(map: Record<string, number>): number {
  return Object.values(map).reduce((s, n) => s + n, 0);
}

export function PlayScreen({
  room,
  selfId,
  engine,
  input,
  error,
  now,
  onInput,
  onHostContinue,
  onLeave,
  onPlayAgain,
}: Props) {
  const ids = room.players.map((p) => p.id);
  const host = room.hostId === selfId;
  const match = currentMatch(engine);
  const pack = currentPack(engine);
  const stances = stancesFor(engine);
  const listeners = listenersOf(engine, ids);
  const isListener = listeners.includes(selfId);
  const isDebater = currentDebaters(engine).includes(selfId);
  const progress = packProgress(engine, ids);
  const packsReady = allRequiredPacksIn(engine, ids);
  const packIn = hasUnusedPack(engine, selfId);
  const [localClapAt, setLocalClapAt] = useState(0);
  const clapAt = Math.max(input.lastClapAt ?? 0, localClapAt);
  const clapLocked = clapAt > 0 && now - clapAt < CLAP_COOLDOWN_MS;
  const [draft, setDraft] = useState({ topic: '', stanceA: '', stanceB: '' });
  const packValid = packTextReady(draft.topic, draft.stanceA, draft.stanceB);
  useEffect(() => {
    if (engine.phase !== 'debate') setLocalClapAt(0);
  }, [engine.phase]);
  const bursts = useClapBursts(engine.clapA, engine.clapB);
  const showLiveScores = engine.phase === 'match_result' || engine.phase === 'champion';
  const upcoming = peekNextMatch(engine);
  const clapsA = clapSum(engine.clapA);
  const clapsB = clapSum(engine.clapB);
  const clapTotal = clapsA + clapsB;
  const turnWho = whoseTurn(engine);
  const turnText = turnLabel(engine);

  const sendPack = () => {
    if (!packValid) return;
    onInput({
      ...input,
      pack: { topic: draft.topic.trim(), stanceA: draft.stanceA.trim(), stanceB: draft.stanceB.trim() },
    });
  };

  const clapSide = (side: 'A' | 'B') => {
    if (clapLocked || !isListener) return;
    setLocalClapAt(now);
    onInput({
      ...input,
      clapsA: (input.clapsA ?? 0) + (side === 'A' ? 1 : 0),
      clapsB: (input.clapsB ?? 0) + (side === 'B' ? 1 : 0),
      lastClapAt: now,
    });
  };

  return (
    <div className="app">
      <p className="brand">
        Debater · {engine.stageKind === 'final' ? 'Final' : `Table of ${engine.activeIds.length}`}
      </p>
      {engine.replayNote ? <p>{engine.replayNote}</p> : null}

      <div className="card fill">
        {(engine.phase === 'collect_packs' || engine.phase === 'collect_final_topics') && (
          <>
            <h2 className="collect-heading">{engine.phase === 'collect_final_topics' ? 'Submit the finals topic' : 'Enter a topic'}</h2>
            <p className="pack-count">
              Topics in {progress.have} / {progress.need || '—'}
            </p>
            {engine.phase === 'collect_final_topics' && engine.activeIds.includes(selfId) ? (
              <p>You are in the final. Wait for listeners to pick a new topic.</p>
            ) : packIn ? (
              <p>Pack in. Waiting on others…</p>
            ) : (
              <>
                <label>Topic</label>
                <input value={draft.topic} onChange={(e) => setDraft({ ...draft, topic: e.target.value })} />
                <label>Stance A</label>
                <textarea rows={2} value={draft.stanceA} onChange={(e) => setDraft({ ...draft, stanceA: e.target.value })} />
                <label>Stance B</label>
                <textarea rows={2} value={draft.stanceB} onChange={(e) => setDraft({ ...draft, stanceB: e.target.value })} />
                <div className="row" style={{ marginTop: 8 }}>
                  <button className="btn" disabled={!packValid} onClick={sendPack}>
                    Submit
                  </button>
                </div>
              </>
            )}
            <div className="dock" style={{ marginTop: 'auto', paddingTop: 8 }}>
              {host ? (
                <button className="btn" disabled={!packsReady} onClick={onHostContinue}>
                  Play round
                </button>
              ) : (
                <span className="names">{packsReady ? 'Waiting for the host.' : 'Waiting for every topic.'}</span>
              )}
            </div>
          </>
        )}

        {engine.phase === 'vote_final_topic' && (
          <>
            <h2>Vote for the finals topic</h2>
            {engine.activeIds.includes(selfId) ? <p>Finalists do not vote.</p> : null}
            <div className="topic-list">
              {listenerPacks(engine).map((p) => (
                <button
                  key={p.id}
                  className="btn ghost"
                  disabled={!isListener || !!input.topicVote}
                  onClick={() => onInput({ ...input, topicVote: p.id })}
                >
                  {p.topic}
                </button>
              ))}
            </div>
            {host ? (
              <div className="dock" style={{ marginTop: 'auto', paddingTop: 8 }}>
                <button className="btn" onClick={onHostContinue}>
                  Tally topic votes
                </button>
              </div>
            ) : null}
          </>
        )}

        {match && stances && pack && (engine.phase === 'prep' || engine.phase === 'debate' || engine.phase === 'split_vote') && (
          <div className="debate-arena">
            {engine.phase === 'debate' ? <ClapBursts bursts={bursts} className="clap-space clap-rail clap-rail-top" rail="top" /> : null}
            <h2 className="topic">{pack.topic}</h2>
            {engine.phase === 'debate' ? (
              <p className="turn-callout">
                {turnWho ? (
                  <>
                    Now speaking:
                    <span className={`turn-callout-name ${turnWho === 'A' ? 'turn-a' : 'turn-b'}`}>
                      {' '}
                      {turnWho === 'A' ? nameOf(room, match.aId) : nameOf(room, match.bId)}
                    </span>
                  </>
                ) : (
                  'Open floor'
                )}
              </p>
            ) : null}
            <div className="debate-mid">
              <div className="split">
                <div className="debater-col">
                  <div className={`debater-frame ${engine.phase === 'debate' && turnWho === 'A' ? 'active-turn' : ''}`}>
                    <p className="side-a player-name">{nameOf(room, match.aId)}</p>
                    <p className="stance">{stances.a}</p>
                  </div>
                  {engine.phase === 'debate' && isListener ? (
                    <ClapButton locked={clapLocked} lastClapAt={clapAt} side="A" onClap={() => clapSide('A')} />
                  ) : null}
                </div>
                <div className="debater-col">
                  <div className={`debater-frame ${engine.phase === 'debate' && turnWho === 'B' ? 'active-turn' : ''}`}>
                    <p className="side-b player-name">{nameOf(room, match.bId)}</p>
                    <p className="stance">{stances.b}</p>
                  </div>
                  {engine.phase === 'debate' && isListener ? (
                    <ClapButton locked={clapLocked} lastClapAt={clapAt} side="B" onClap={() => clapSide('B')} />
                  ) : null}
                </div>
              </div>
            </div>
            {engine.phase === 'debate' ? (
              <div className="meter clap-meter" aria-hidden>
                <span className="m-a" style={{ width: `${clapTotal ? (100 * clapsA) / clapTotal : 50}%` }} />
                <span className="m-b" style={{ width: `${clapTotal ? (100 * clapsB) / clapTotal : 50}%` }} />
              </div>
            ) : null}
            {engine.phase === 'debate' ? <ClapBursts bursts={bursts} className="clap-space clap-rail clap-rail-bottom" rail="bottom" /> : null}
            {engine.phaseEndsAtMs ? <div className="timer">{remaining(engine.phaseEndsAtMs, now)}</div> : null}
            {engine.phase === 'debate' ? (
              <p className="turn-indicator">
                {turnWho ? (
                  <>
                    <span className={`turn-who ${turnWho === 'A' ? 'turn-a' : 'turn-b'}`}>Turn: {turnWho}</span>
                    <span className="turn-label">{turnText}</span>
                  </>
                ) : (
                  <span className="turn-label">{turnText ?? 'Open floor'}</span>
                )}
              </p>
            ) : null}
          </div>
        )}

        {engine.phase === 'split_vote' && (
          <>
            {isDebater ? <p>Debaters wait. Listeners split {VOTE_POINTS}.</p> : null}
            {isListener && input.splitA == null ? (
              <SplitPicker
                value={typeof input.splitA === 'number' ? input.splitA : VOTE_POINTS / 2}
                onCommit={(v) => onInput({ ...input, splitA: v })}
                aName={match ? nameOf(room, match.aId) : 'A'}
                bName={match ? nameOf(room, match.bId) : 'B'}
              />
            ) : isListener ? (
              <p>
                Locked {input.splitA}–{VOTE_POINTS - (input.splitA ?? 0)}
                {input.splitA === VOTE_POINTS / 2 ? ' (tie)' : ''}.
              </p>
            ) : null}
          </>
        )}

        {engine.phase === 'match_result' && match && (
          <div className="result-board">
            <h2 className="result-title">{engine.lastDraw ? 'Draw' : 'Result'}</h2>
            <p className="result-score">
              {nameOf(room, match.aId)} {formatPoints(engine.lastPointsA)}
              <span> · </span>
              {nameOf(room, match.bId)} {formatPoints(engine.lastPointsB)}
            </p>
            <Scoreboard room={room} engine={engine} showScores />
            {upcoming ? (
              <p className="next-up">
                Next up: {nameOf(room, upcoming.aId)} vs {nameOf(room, upcoming.bId)}
              </p>
            ) : engine.stageKind === 'final' ? (
              <p className="next-up">{engine.lastDraw ? 'Finalists replay with a new topic.' : 'That was the final.'}</p>
            ) : (
              <p className="next-up">End of this round.</p>
            )}
            <div className="dock" style={{ marginTop: 'auto', paddingTop: 8 }}>
              {host ? (
                <button className="btn" onClick={onHostContinue}>
                  Continue
                </button>
              ) : (
                <span className="names">Waiting for the host.</span>
              )}
            </div>
          </div>
        )}

        {engine.phase === 'champion' && (
          <ChampionPanel
            engine={engine}
            host={host}
            nameOf={(id) => nameOf(room, id)}
            onPlayAgain={onPlayAgain}
          />
        )}
      </div>

      <div className="dock">
        <span className="names">
          {showLiveScores
            ? engine.activeIds.map((id) => `${nameOf(room, id)} ${formatPoints(engine.scores[id] ?? 0)}`).join(' · ')
            : engine.activeIds.map((id) => nameOf(room, id)).join(' · ')}
        </span>
        {error ? <span className="err">{error}</span> : null}
        <button className="btn ghost tiny" onClick={onLeave}>
          Leave
        </button>
      </div>
    </div>
  );
}

function ClapButton({
  locked,
  lastClapAt,
  side,
  onClap,
}: {
  locked: boolean;
  lastClapAt: number;
  side: 'A' | 'B';
  onClap(): void;
}) {
  return (
    <button className={`btn clap-btn ${side === 'A' ? 'a' : 'b'} ${locked ? 'cooling' : ''}`} disabled={locked} onClick={onClap}>
      Clap
      {locked ? <span key={lastClapAt} className="cool-bar" style={{ animationDuration: `${CLAP_COOLDOWN_MS}ms` }} /> : null}
    </button>
  );
}

function Scoreboard({ room, engine, showScores }: { room: Room; engine: Engine; showScores: boolean }) {
  const rows = [...engine.activeIds].sort((a, b) => (engine.scores[b] ?? 0) - (engine.scores[a] ?? 0));
  return (
    <div className="scoreboard">
      {rows.map((id) => (
        <div key={id}>
          <span>{room.players.find((p) => p.id === id)?.name ?? id.slice(0, 6)}</span>
          <span>{showScores ? formatPoints(engine.scores[id] ?? 0) : ''}</span>
        </div>
      ))}
    </div>
  );
}

function ChampionPanel({
  engine,
  host,
  nameOf,
  onPlayAgain,
}: {
  engine: Engine;
  host: boolean;
  nameOf(id: string): string;
  onPlayAgain(): void;
}) {
  const [showSummary, setShowSummary] = useState(false);
  const [roundIdx, setRoundIdx] = useState(0);

  const rounds = useMemo(() => {
    const groups: { matchIndex: number; pack: (typeof engine.packPool)[0] | null; match: (typeof engine.matches)[0]; pointsA: number; pointsB: number }[][] = [];
    let current: typeof groups[0] = [];
    for (let i = 0; i < engine.matches.length; i++) {
      const m = engine.matches[i]!;
      const pack = engine.packPool.find((p) => p.id === m.packId) ?? null;
      current.push({ matchIndex: i, pack, match: m, pointsA: 0, pointsB: 0 });
      const nextMatch = engine.matches[i + 1];
      const sameStage = nextMatch && nextMatch.aId !== m.aId;
      if (!nextMatch || !sameStage) {
        groups.push(current);
        current = [];
      }
    }
    if (current.length) groups.push(current);
    return groups;
  }, [engine.matches, engine.packPool]);

  const roundItems = rounds[roundIdx] ?? [];
  const totalRounds = rounds.length;

  if (showSummary) {
    return (
      <div className="summary-view">
        <div className="summary-nav">
          <button className="btn ghost tiny" disabled={roundIdx === 0} onClick={() => setRoundIdx((r) => r - 1)}>
            ‹
          </button>
          <span className="summary-round-label">Round {roundIdx + 1} of {totalRounds}</span>
          <button className="btn ghost tiny" disabled={roundIdx >= totalRounds - 1} onClick={() => setRoundIdx((r) => r + 1)}>
            ›
          </button>
        </div>
        <div className="summary-table-wrap">
          <table className="summary-table">
            <thead>
              <tr>
                <th>Topic</th>
                <th>Suggested by</th>
                <th>Debaters</th>
              </tr>
            </thead>
            <tbody>
              {roundItems.map(({ match, pack }) => (
                <tr key={match.packId}>
                  <td>
                    <div className="summary-topic">{pack?.topic ?? '—'}</div>
                    <div className="summary-stances">
                      <span className="side-a">{pack?.stanceA ?? ''}</span>
                      {' · '}
                      <span className="side-b">{pack?.stanceB ?? ''}</span>
                    </div>
                  </td>
                  <td>{pack ? nameOf(pack.authorId) : '—'}</td>
                  <td>
                    <span className="side-a">{nameOf(match.aId)}</span>
                    {' vs '}
                    <span className="side-b">{nameOf(match.bId)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="summary-scores">
          <h3>Final scores</h3>
          {[...engine.activeIds]
            .sort((a, b) => (engine.scores[b] ?? 0) - (engine.scores[a] ?? 0))
            .map((id) => (
              <div key={id} className="summary-score-row">
                <span>{nameOf(id)}{id === engine.championId ? ' 🏆' : ''}</span>
                <span>{engine.scores[id] ?? 0}</span>
              </div>
            ))}
        </div>
        <button className="btn ghost tiny" style={{ marginTop: 'auto' }} onClick={() => setShowSummary(false)}>
          ← Back
        </button>
      </div>
    );
  }

  return (
    <div className="champion-board">
      <div className="trophy-wrap" aria-hidden>
        <img className="trophy-gif" src={`${import.meta.env.BASE_URL}trophy.svg`} alt="" />
      </div>
      <h2>Champion</h2>
      <p className="champion-name">{engine.championId ? nameOf(engine.championId) : '—'}</p>
      <div className="dock" style={{ marginTop: 'auto', paddingTop: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
        <button className="btn ghost tiny" onClick={() => { setRoundIdx(0); setShowSummary(true); }}>
          Game summary
        </button>
        {host ? (
          <button className="btn" onClick={onPlayAgain}>
            Play again
          </button>
        ) : null}
      </div>
    </div>
  );
}

function SplitPicker({
  value,
  onCommit,
  aName,
  bName,
}: {
  value: number;
  onCommit(v: number): void;
  aName: string;
  bName: string;
}) {
  const [v, setV] = useState(value);
  const tie = v === VOTE_POINTS / 2;
  return (
    <>
      <p>
        {aName} {v} · {bName} {VOTE_POINTS - v}
        {tie ? ' · tie' : ''}
      </p>
      <input type="range" min={0} max={VOTE_POINTS} value={v} onChange={(e) => setV(Number(e.target.value))} />
      <div className="row" style={{ marginTop: 8 }}>
        <button className="btn" onClick={() => onCommit(v)}>
          Lock {tie ? 'tie 5–5' : `${v}–${VOTE_POINTS - v}`}
        </button>
      </div>
    </>
  );
}

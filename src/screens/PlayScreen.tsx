import { useEffect, useMemo, useState } from 'react';
import {
  allTopicVotesIn,
  allRequiredPacksIn,
  CLAP_COOLDOWN_MS,
  VOTE_POINTS,
  currentDebaters,
  currentMatch,
  currentPack,
  eliminationsThisStage,
  formatPoints,
  isPaused,
  listenerPacks,
  listenersOf,
  packProgress,
  packTextReady,
  peekNextMatch,
  splitVoteProgress,
  hasUnusedPack,
  expectedPackAuthors,
  submittedPackAuthors,
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
  onHostPause(): void;
  onHostSkip(): void;
  onLeave(): void;
  onPlayAgain(): void;
};

function nameOf(room: Room, id: string): string {
  return room.players.find((p) => p.id === id)?.name ?? id.slice(0, 6);
}

function remainingSeconds(ends: number | null, now: number, pausedMs: number | null = null): number | null {
  if (pausedMs != null) return Math.max(0, Math.ceil(pausedMs / 1000));
  if (ends == null) return null;
  return Math.max(0, Math.ceil((ends - now) / 1000));
}

function remaining(ends: number | null, now: number, pausedMs: number | null = null): string {
  const s = remainingSeconds(ends, now, pausedMs);
  if (s == null) return '';
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
  onHostPause,
  onHostSkip,
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
  const paused = isPaused(engine);
  const voteProgress = splitVoteProgress(engine, ids);
  const finalTopicVoters = ids.filter((id) => !engine.activeIds.includes(id));
  const finalTopicVotesIn = finalTopicVoters.filter((id) => !!engine.topicVotes[id]).length;
  const allFinalTopicVotesIn = allTopicVotesIn(engine, ids);
  const waitingTopicIds = expectedPackAuthors(engine, ids).filter(
    (id) => !submittedPackAuthors(engine, ids).includes(id),
  );
  const dropCount = eliminationsThisStage(engine.stageKind);
  const showDangerChip =
    dropCount > 0 &&
    (engine.phase === 'prep' || engine.phase === 'debate' || engine.phase === 'split_vote');
  const secsLeft = remainingSeconds(engine.phaseEndsAtMs, now, engine.pauseRemainingMs);
  const timerUrgent = engine.phase === 'debate' && !paused && secsLeft != null && secsLeft <= 10;

  const sendPack = () => {
    if (!packValid) return;
    onInput({
      ...input,
      pack: { topic: draft.topic.trim(), stanceA: draft.stanceA.trim(), stanceB: draft.stanceB.trim() },
    });
  };

  const clapSide = (side: 'A' | 'B') => {
    if (paused || clapLocked || !isListener) return;
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
            {!packsReady && waitingTopicIds.length > 0 ? (
              <p className="waiting-list">
                Waiting on: {waitingTopicIds.map((id) => nameOf(room, id)).join(', ')}
              </p>
            ) : null}
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
            <p className="vote-progress">
              Votes in {finalTopicVotesIn} / {finalTopicVoters.length || '—'}
            </p>
            {engine.activeIds.includes(selfId) ? (
              <p className="finalist-wait">You are a finalist. Wait while the listeners choose the finals topic.</p>
            ) : (
              <div className="topic-list">
                {listenerPacks(engine).map((p) => (
                  <button
                    key={p.id}
                    className="btn ghost"
                    disabled={!!input.topicVote}
                    onClick={() => onInput({ ...input, topicVote: p.id })}
                  >
                    {p.topic}
                  </button>
                ))}
              </div>
            )}
            {host ? (
              <div className="dock" style={{ marginTop: 'auto', paddingTop: 8 }}>
                <button className="btn" disabled={!allFinalTopicVotesIn} onClick={onHostContinue}>
                  Tally topic votes
                </button>
              </div>
            ) : null}
          </>
        )}

        {match && stances && pack && (engine.phase === 'prep' || engine.phase === 'debate' || engine.phase === 'split_vote') && (
          <div className={`debate-arena${engine.phase === 'debate' ? ' is-debate' : ''}`}>
            {paused ? <p className="host-status-banner pause">Paused by host</p> : null}
            {showDangerChip ? (
              <p className="danger-chip">Lowest {dropCount} eliminated this round</p>
            ) : null}
            {engine.phase === 'debate' ? <ClapBursts bursts={bursts} className="clap-space clap-rail clap-rail-top" rail="top" /> : null}
            <div className="debate-focus">
              <h2 className="topic">{pack.topic}</h2>
              {engine.phase === 'prep' ? <p className="prep-banner">Preparation</p> : null}
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
              {engine.phaseEndsAtMs || paused ? (
                <div className="timer-slot">
                  <div className={`timer${paused ? ' paused' : ''}${timerUrgent ? ' urgent' : ''}`}>
                    {remaining(engine.phaseEndsAtMs, now, engine.pauseRemainingMs)}
                    {paused ? <span className="paused-tag">Paused</span> : null}
                    {timerUrgent ? <span className="urgent-tag">Hurry</span> : null}
                  </div>
                </div>
              ) : (
                <div className="timer-slot timer-slot-empty" aria-hidden />
              )}
            </div>
            <div className="debate-mid">
              <div className="split">
                <div className="debater-col">
                  <div className={`debater-frame ${engine.phase === 'debate' && turnWho === 'A' ? 'active-turn' : ''}`}>
                    <p className="side-a player-name">{nameOf(room, match.aId)}</p>
                    <p className="stance">{stances.a}</p>
                  </div>
                  {engine.phase === 'debate' && isListener ? (
                    <ClapButton locked={paused || clapLocked} lastClapAt={clapAt} side="A" onClap={() => clapSide('A')} />
                  ) : null}
                </div>
                <div className="debater-col">
                  <div className={`debater-frame ${engine.phase === 'debate' && turnWho === 'B' ? 'active-turn' : ''}`}>
                    <p className="side-b player-name">{nameOf(room, match.bId)}</p>
                    <p className="stance">{stances.b}</p>
                  </div>
                  {engine.phase === 'debate' && isListener ? (
                    <ClapButton locked={paused || clapLocked} lastClapAt={clapAt} side="B" onClap={() => clapSide('B')} />
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
            {host && (engine.phase === 'prep' || engine.phase === 'debate') ? (
              <div className="host-timer-controls">
                <button className="btn ghost tiny" onClick={onHostPause}>
                  {paused ? 'Unpause' : 'Pause'}
                </button>
                <button className="btn ghost tiny" onClick={onHostSkip}>
                  Skip to vote
                </button>
              </div>
            ) : null}
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
            {engine.hostNotice ? <p className="host-status-banner skip">{engine.hostNotice}</p> : null}
            <p className="vote-progress">
              Votes in {voteProgress.have} / {voteProgress.need || '—'}
            </p>
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
            <Scoreboard
              room={room}
              engine={engine}
              showScores
              highlightOutcome={engine.stageKind !== 'final'}
              dangerNote={
                engine.stageKind !== 'final' && upcoming
                  ? `Danger zone: lowest ${eliminationsThisStage(engine.stageKind)} will be eliminated this round`
                  : engine.stageKind !== 'final' && !upcoming
                    ? `Eliminated: lowest ${eliminationsThisStage(engine.stageKind)}`
                    : null
              }
            />
            {upcoming ? (
              <p className="next-up">
                Next up: {nameOf(room, upcoming.aId)} vs {nameOf(room, upcoming.bId)}
              </p>
            ) : engine.stageKind === 'final' ? (
              <p className="next-up">{engine.lastDraw ? 'Finalists replay with a new topic.' : 'That was the final.'}</p>
            ) : (
              <p className="next-up">End of this round.</p>
            )}
            <div className="dock result-actions">
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

function Scoreboard({
  room,
  engine,
  showScores,
  highlightOutcome = false,
  dangerNote = null,
}: {
  room: Room;
  engine: Engine;
  showScores: boolean;
  highlightOutcome?: boolean;
  dangerNote?: string | null;
}) {
  const rows = [...engine.activeIds].sort((a, b) => (engine.scores[b] ?? 0) - (engine.scores[a] ?? 0));
  const cutoff = eliminationsThisStage(engine.stageKind);
  const sortedAsc = [...engine.activeIds].sort((a, b) => (engine.scores[a] ?? 0) - (engine.scores[b] ?? 0) || a.localeCompare(b));
  const eliminated = highlightOutcome && cutoff > 0 ? new Set(sortedAsc.slice(0, cutoff)) : new Set<string>();
  return (
    <div className="scoreboard">
      {dangerNote ? <p className="danger-note">{dangerNote}</p> : null}
      {rows.map((id) => (
        <div
          key={id}
          className={
            highlightOutcome ? (eliminated.has(id) ? 'score-out' : 'score-safe') : undefined
          }
        >
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
    const byRound = new Map<number, typeof engine.matchHistory>();
    for (const entry of engine.matchHistory) {
      const list = byRound.get(entry.roundIndex) ?? [];
      list.push(entry);
      byRound.set(entry.roundIndex, list);
    }
    return [...byRound.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, entries]) => entries);
  }, [engine.matchHistory]);

  const roundItems = rounds[roundIdx] ?? [];
  const totalRounds = rounds.length;
  const roundLabel = roundItems[0]?.stageKind === 'final' ? 'Finals' : `Round ${roundIdx + 1}`;

  if (showSummary) {
    return (
      <div className="summary-view">
        <div className="summary-nav">
          <button className="btn ghost tiny" disabled={roundIdx === 0} onClick={() => setRoundIdx((r) => r - 1)}>
            ‹
          </button>
          <span className="summary-round-label">
            {roundLabel}
            {totalRounds > 1 ? ` · ${roundIdx + 1}/${totalRounds}` : ''}
          </span>
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
                <th>Score</th>
              </tr>
            </thead>
            <tbody>
              {roundItems.map((entry) => (
                <tr key={`${entry.roundIndex}-${entry.packId}-${entry.aId}-${entry.bId}`}>
                  <td>
                    <div className="summary-topic">{entry.topic || '—'}</div>
                    <div className="summary-stances">
                      <span className="side-a">{entry.stanceA}</span>
                      {' · '}
                      <span className="side-b">{entry.stanceB}</span>
                    </div>
                  </td>
                  <td>{entry.authorId ? nameOf(entry.authorId) : '—'}</td>
                  <td>
                    <span className="side-a">{nameOf(entry.aId)}</span>
                    {' vs '}
                    <span className="side-b">{nameOf(entry.bId)}</span>
                  </td>
                  <td>
                    {formatPoints(entry.pointsA)} · {formatPoints(entry.pointsB)}
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
                <span>
                  {nameOf(id)}
                  {id === engine.championId ? ' 🏆' : ''}
                </span>
                <span>{formatPoints(engine.scores[id] ?? 0)}</span>
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
      <div className="champion-center">
        <div className="trophy-wrap" aria-hidden>
          <img className="trophy-gif" src={`${import.meta.env.BASE_URL}trophy.svg`} alt="" />
        </div>
        <h2>Champion</h2>
        <p className="champion-name">{engine.championId ? nameOf(engine.championId) : '—'}</p>
      </div>
      <div className="dock champion-actions">
        <button
          className="btn ghost summary-btn"
          onClick={() => {
            setRoundIdx(0);
            setShowSummary(true);
          }}
        >
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
  const pointsA = v;
  const pointsB = VOTE_POINTS - v;
  const tie = pointsA === pointsB;
  // Slider left = more for A (left player), right = more for B.
  const slider = VOTE_POINTS - v;
  return (
    <div className="split-picker">
      <div className="split-preview">
        <div className="split-preview-side side-a">
          <span className="split-preview-name">{aName}</span>
          <span key={`a-${pointsA}`} className="split-preview-points">
            {pointsA}
          </span>
        </div>
        <div className="split-preview-side side-b">
          <span className="split-preview-name">{bName}</span>
          <span key={`b-${pointsB}`} className="split-preview-points">
            {pointsB}
          </span>
        </div>
      </div>
      <input
        type="range"
        min={0}
        max={VOTE_POINTS}
        value={slider}
        onChange={(e) => setV(VOTE_POINTS - Number(e.target.value))}
        aria-label={`Points for ${aName} vs ${bName}`}
      />
      <div className="split-preview-bar" aria-hidden>
        <span className="m-a" style={{ width: `${(100 * pointsA) / VOTE_POINTS}%` }} />
        <span className="m-b" style={{ width: `${(100 * pointsB) / VOTE_POINTS}%` }} />
      </div>
      <div className="row" style={{ marginTop: 8, justifyContent: 'center' }}>
        <button className="btn" onClick={() => onCommit(v)}>
          Lock {tie ? 'tie 5–5' : `${pointsA}–${pointsB}`}
        </button>
      </div>
    </div>
  );
}

import { useMemo, useState } from 'react';
import {
  CLAP_COOLDOWN_MS,
  MIN_TEXT,
  VOTE_POINTS,
  currentDebaters,
  currentMatch,
  currentPack,
  formatPoints,
  listenerPacks,
  listenersOf,
  matchPoints,
  playersNeedingPack,
  stancesFor,
  turnLabel,
  whoseTurn,
  type Engine,
} from '../lib/engine';
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
  const needPack = playersNeedingPack(engine).includes(selfId);

  const clapLocked = now - (input.lastClapAt ?? 0) < CLAP_COOLDOWN_MS;
  const [draft, setDraft] = useState({ topic: '', stanceA: '', stanceB: '' });

  const totals = useMemo(() => {
    const a = Object.values(engine.clapA).reduce((s, n) => s + n, 0);
    const b = Object.values(engine.clapB).reduce((s, n) => s + n, 0);
    return { a, b };
  }, [engine.clapA, engine.clapB]);

  const livePts = match ? matchPoints(engine, ids) : { a: 0, b: 0 };

  const sendPack = () => {
    if (draft.topic.trim().length < MIN_TEXT) return;
    onInput({
      ...input,
      pack: { topic: draft.topic, stanceA: draft.stanceA, stanceB: draft.stanceB },
    });
  };

  const clapSide = (side: 'A' | 'B') => {
    if (clapLocked || !isListener) return;
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
        {engine.stageKind === 'final' ? 'Final' : `Table of ${engine.activeIds.length}`} · {engine.phase.replaceAll('_', ' ')}
      </p>
      {engine.replayNote ? <p>{engine.replayNote}</p> : null}

      {(engine.phase === 'collect_packs' || engine.phase === 'collect_final_topics') && (
        <div className="card">
          <h2>{engine.phase === 'collect_final_topics' ? 'Listeners: propose a finals topic' : 'Write a debate pack'}</h2>
          <p>
            {engine.phase === 'collect_final_topics'
              ? 'Finalists sit this out. Submit topic + two opposing stances.'
              : 'Topic + two opposing stances. You will not debate your own topic.'}
          </p>
          {engine.phase === 'collect_final_topics' && engine.activeIds.includes(selfId) ? (
            <p>You are in the final. Wait for listeners.</p>
          ) : (engine.phase === 'collect_packs' && !needPack && engine.activeIds.includes(selfId)) ||
            input.pack ? (
            <p>Pack in. Waiting on others…</p>
          ) : (
            <>
              <label>Topic</label>
              <input value={draft.topic} onChange={(e) => setDraft({ ...draft, topic: e.target.value })} />
              <label>Stance A</label>
              <textarea rows={2} value={draft.stanceA} onChange={(e) => setDraft({ ...draft, stanceA: e.target.value })} />
              <label>Stance B</label>
              <textarea rows={2} value={draft.stanceB} onChange={(e) => setDraft({ ...draft, stanceB: e.target.value })} />
              <div className="row" style={{ marginTop: 10 }}>
                <button className="btn" onClick={sendPack}>
                  Submit pack
                </button>
              </div>
            </>
          )}
          {host ? (
            <div className="row" style={{ marginTop: 12 }}>
              <button className="btn" onClick={onHostContinue}>
                Continue
              </button>
            </div>
          ) : null}
        </div>
      )}

      {engine.phase === 'vote_final_topic' && (
        <div className="card">
          <h2>Vote for the finals topic</h2>
          {engine.activeIds.includes(selfId) ? <p>Finalists do not vote.</p> : null}
          {listenerPacks(engine).map((p) => (
            <button
              key={p.id}
              className="btn ghost"
              style={{ width: '100%', margin: '6px 0' }}
              disabled={!isListener || !!input.topicVote}
              onClick={() => onInput({ ...input, topicVote: p.id })}
            >
              {p.topic}
            </button>
          ))}
          {host ? (
            <button className="btn" onClick={onHostContinue}>
              Tally topic votes
            </button>
          ) : null}
        </div>
      )}

      {match && stances && pack && engine.phase !== 'collect_packs' && engine.phase !== 'collect_final_topics' && engine.phase !== 'champion' && engine.phase !== 'vote_final_topic' && (
        <div className="card">
          <h2>{pack.topic}</h2>
          <div className="split">
            <div>
              <p className="side-a">
                {nameOf(room, match.aId)} {match.leftoverBonus ? '(+1 / listener)' : ''}
              </p>
              <p>{stances.a}</p>
            </div>
            <div>
              <p className="side-b">{nameOf(room, match.bId)}</p>
              <p>{stances.b}</p>
            </div>
          </div>
          {engine.phaseEndsAtMs ? <div className="timer">{remaining(engine.phaseEndsAtMs, now)}</div> : null}
          {engine.phase === 'debate' ? (
            <p>
              {turnLabel(engine)}
              {whoseTurn(engine) ? ` · floor: ${whoseTurn(engine)}` : ''}
            </p>
          ) : null}
          {engine.phase === 'debate' && isListener ? (
            <div className="row">
              <button className="btn a" disabled={clapLocked} onClick={() => clapSide('A')}>
                Clap A
              </button>
              <button className="btn b" disabled={clapLocked} onClick={() => clapSide('B')}>
                Clap B
              </button>
            </div>
          ) : null}
          {engine.phase === 'debate' || engine.phase === 'split_vote' ? (
            <>
              <div className="meter" style={{ marginTop: 10 }}>
                <span style={{ width: `${(100 * totals.a) / Math.max(1, totals.a + totals.b)}%` }} />
                <span style={{ width: `${(100 * totals.b) / Math.max(1, totals.a + totals.b)}%` }} />
              </div>
              <p>
                Claps {totals.a}–{totals.b} · live {formatPoints(livePts.a)}–{formatPoints(livePts.b)}
              </p>
            </>
          ) : null}
        </div>
      )}

      {engine.phase === 'split_vote' && (
        <div className="card">
          <h2>Split 11 votes</h2>
          {isDebater ? <p>Debaters don&apos;t vote. Wait for listeners.</p> : null}
          {isListener && input.splitA == null ? (
            <>
              <p>
                Give {VOTE_POINTS} points between the two. Closest even split is 6–5.
              </p>
              <SplitPicker
                value={typeof input.splitA === 'number' ? input.splitA : 6}
                onCommit={(v) => onInput({ ...input, splitA: v })}
                aName={match ? nameOf(room, match.aId) : 'A'}
                bName={match ? nameOf(room, match.bId) : 'B'}
              />
            </>
          ) : isListener ? (
            <p>
              Locked {input.splitA}–{VOTE_POINTS - (input.splitA ?? 0)}.
            </p>
          ) : null}
        </div>
      )}

      {engine.phase === 'match_result' && match && (
        <div className="card">
          <h2>{engine.lastDraw ? 'Draw — both keep their points' : 'Result'}</h2>
          <p>
            {nameOf(room, match.aId)} {formatPoints(engine.lastPointsA)} · {nameOf(room, match.bId)}{' '}
            {formatPoints(engine.lastPointsB)}
          </p>
          <Scoreboard room={room} engine={engine} />
          {host ? (
            <button className="btn" onClick={onHostContinue}>
              Continue
            </button>
          ) : (
            <p>Waiting for the host.</p>
          )}
        </div>
      )}

      {engine.phase === 'champion' && (
        <div className="card">
          <h2>Champion</h2>
          <p className="code" style={{ letterSpacing: '0.06em', fontSize: '1.3rem' }}>
            {engine.championId ? nameOf(room, engine.championId) : '—'}
          </p>
          {host ? (
            <button className="btn" onClick={onPlayAgain}>
              Play again
            </button>
          ) : null}
        </div>
      )}

      <div className="card">
        <h2>Table</h2>
        <Scoreboard room={room} engine={engine} />
        {host ? null : <p>Host advances the night.</p>}
        <button className="btn ghost" onClick={onLeave}>
          Leave
        </button>
      </div>
      {error ? <p className="err">{error}</p> : null}
    </div>
  );
}

function Scoreboard({ room, engine }: { room: Room; engine: Engine }) {
  const rows = [...engine.activeIds].sort((a, b) => (engine.scores[b] ?? 0) - (engine.scores[a] ?? 0));
  const listeners = room.players.filter((p) => !engine.activeIds.includes(p.id));
  return (
    <div className="scoreboard">
      {rows.map((id) => (
        <div key={id}>
          <span>{room.players.find((p) => p.id === id)?.name ?? id.slice(0, 6)}</span>
          <span>{formatPoints(engine.scores[id] ?? 0)}</span>
        </div>
      ))}
      {listeners.length ? (
        <p style={{ marginTop: 8 }}>Listening: {listeners.map((p) => p.name).join(', ')}</p>
      ) : null}
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
  return (
    <>
      <input type="range" min={0} max={VOTE_POINTS} value={v} onChange={(e) => setV(Number(e.target.value))} />
      <p>
        {aName} {v} · {bName} {VOTE_POINTS - v}
      </p>
      <button className="btn" onClick={() => onCommit(v)}>
        Lock {v}–{VOTE_POINTS - v}
      </button>
    </>
  );
}

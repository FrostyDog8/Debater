import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  DEBATE_MAX_SEC,
  DEBATE_MIN_SEC,
  DEBATE_STEP_SEC,
  MIN_START_PLAYERS,
  PREP_MAX_SEC,
  PREP_MIN_SEC,
  PREP_STEP_SEC,
  type Settings,
  type SpeakMode,
} from '../lib/engine';
import { joinUrl, type Room } from '../lib/session';

type Props = {
  room: Room;
  selfId: string;
  settings: Settings;
  error: string | null;
  onSettings(next: Settings): void;
  onReady(ready: boolean): void;
  onStart(): void;
  onKick(id: string): void;
  onLeave(): void;
  onCopy(): void;
  onName(name: string): void;
};

export function LobbyScreen({
  room,
  selfId,
  settings,
  error,
  onSettings,
  onReady,
  onStart,
  onKick,
  onLeave,
  onCopy,
  onName,
}: Props) {
  const host = room.hostId === selfId;
  const self = room.players.find((p) => p.id === selfId);
  const canStart = host && room.players.length >= MIN_START_PLAYERS;
  const [copied, setCopied] = useState(false);
  const [draftName, setDraftName] = useState(self?.name ?? '');
  const [twoCols, setTwoCols] = useState(false);
  const nameTimer = useRef<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setDraftName(self?.name ?? '');
  }, [self?.name]);

  const listed = [...room.players].sort((a, b) => {
    if (a.id === selfId) return -1;
    if (b.id === selfId) return 1;
    return 0;
  });

  // Prefer one column while it fits; switch to two columns when the list would overflow.
  // Scrolling only kicks in after two columns still exceed the available height.
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;

    const measure = () => {
      const rows = [...list.querySelectorAll<HTMLElement>('.player-row')];
      if (rows.length < 2) {
        setTwoCols(false);
        return;
      }
      const styles = getComputedStyle(list);
      const gap = parseFloat(styles.rowGap || styles.gap || '0') || 0;
      let singleColHeight = 0;
      rows.forEach((row, i) => {
        singleColHeight += row.getBoundingClientRect().height;
        if (i > 0) singleColHeight += gap;
      });
      const available = list.clientHeight;
      setTwoCols(available > 0 && singleColHeight > available + 1);
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(list);
    if (list.parentElement) ro.observe(list.parentElement);
    return () => ro.disconnect();
  }, [listed.length]);

  const commit = (next: Settings) => onSettings(next);

  const rename = (raw: string) => {
    setDraftName(raw);
    if (nameTimer.current) window.clearTimeout(nameTimer.current);
    nameTimer.current = window.setTimeout(() => {
      const trimmed = raw.trim();
      if (trimmed.length < 2) return;
      onName(trimmed);
    }, 250);
  };

  return (
    <div className="app lobby">
      <p className="brand">Lobby</p>
      <div className="card lobby-code-card" style={{ flex: '0 0 auto' }}>
        <div className="lobby-code-line">
          <span className="lobby-code-label">Lobby Code:</span>
          <span className="code">{room.roomCode}</span>
        </div>
        <div className="lobby-link-row">
          <p className="join-url" title={joinUrl(room.roomCode)}>
            {joinUrl(room.roomCode)}
          </p>
          <button
            className="btn ghost tiny"
            onClick={async () => {
              await onCopy();
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1600);
            }}
          >
            {copied ? 'Copied' : 'Copy link'}
          </button>
        </div>
      </div>
      <div className="lobby-grid">
        <div className="card fill players-card">
          <h2>Players ({room.players.length})</h2>
          <div ref={listRef} className={`player-list roster-view${twoCols ? ' cols-2' : ''}`}>
            {listed.map((p) => (
              <div key={p.id} className={`player-row${p.id === selfId ? ' self' : ''}`}>
                {p.id === selfId ? (
                  <input
                    className="name-edit"
                    value={draftName}
                    maxLength={24}
                    aria-label="Your name"
                    onChange={(e) => rename(e.target.value)}
                  />
                ) : (
                  <span className="player-name-line">{p.name}</span>
                )}
                <span className={`player-meta${p.id === selfId && p.id === room.hostId ? ' stacked' : ''}`}>
                  {p.id === selfId ? <span className="you-tag">you</span> : null}
                  {p.id === room.hostId ? <span className="host-tag">host</span> : null}
                </span>
                {host && p.id !== selfId ? (
                  <button className="btn ghost tiny kick-btn" onClick={() => onKick(p.id)}>
                    Kick
                  </button>
                ) : (
                  <span className="kick-slot" aria-hidden />
                )}
              </div>
            ))}
          </div>
        </div>
        <div className="card settings-card">
          <h2>Game settings</h2>
          <div className="settings-grid">
            <TimeStepper
              label="Preparation Time"
              value={settings.prepSeconds}
              min={PREP_MIN_SEC}
              step={PREP_STEP_SEC}
              max={PREP_MAX_SEC}
              disabled={!host}
              onChange={(prepSeconds) => commit({ ...settings, prepSeconds })}
            />
            <TimeStepper
              label="Debate Time"
              value={settings.debateSeconds}
              min={DEBATE_MIN_SEC}
              step={DEBATE_STEP_SEC}
              max={DEBATE_MAX_SEC}
              disabled={!host}
              onChange={(debateSeconds) => commit({ ...settings, debateSeconds })}
            />
            <div className="wide">
              <label className="setting-label">Speak mode</label>
              <select
                value={settings.speakMode}
                disabled={!host}
                onChange={(e) => commit({ ...settings, speakMode: e.target.value as SpeakMode })}
              >
                <option value="timed_turns">Timed turns</option>
                <option value="free_for_all">Free-for-all</option>
              </select>
            </div>
          </div>
        </div>
      </div>
      <div className="dock lobby-dock">
        <button className="btn ghost ready-btn" onClick={() => onReady(!self?.isReady)}>
          {self?.isReady ? 'Unready' : 'Ready'}
        </button>
        {host ? (
          <button className="btn" disabled={!canStart} onClick={onStart}>
            Start game
          </button>
        ) : (
          <span className="names">Waiting for the host.</span>
        )}
        <button className="btn danger" onClick={onLeave}>
          {host ? 'Close' : 'Leave'}
        </button>
      </div>
      {error ? <p className="err">{error}</p> : null}
    </div>
  );
}

function TimeStepper({
  label,
  value,
  min,
  step,
  max,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  step: number;
  max: number;
  disabled: boolean;
  onChange(next: number): void;
}) {
  return (
    <div className="stepper-block">
      <label className="setting-label">{label}</label>
      <div className="stepper">
        <button
          type="button"
          className="btn ghost tiny stepper-btn"
          disabled={disabled || value <= min}
          onClick={() => onChange(Math.max(min, value - step))}
        >
          −
        </button>
        <span className="stepper-value">{value}s</span>
        <button
          type="button"
          className="btn ghost tiny stepper-btn"
          disabled={disabled || value >= max}
          onClick={() => onChange(Math.min(max, value + step))}
        >
          +
        </button>
      </div>
    </div>
  );
}

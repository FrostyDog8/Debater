import { AdSlot } from '../components/AdSlot';
import { MIN_START_PLAYERS, type Settings, type SpeakMode } from '../lib/engine';
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
}: Props) {
  const host = room.hostId === selfId;
  const self = room.players.find((p) => p.id === selfId);
  const canStart = host && room.players.length >= MIN_START_PLAYERS;

  return (
    <div className="app">
      <p className="brand">Lobby</p>
      <h1>Room {room.roomCode}</h1>
      <p>
        Share this code or the link. Need at least {MIN_START_PLAYERS} players. Voice stays on Discord or in the room.
      </p>
      <div className="card">
        <div className="code">{room.roomCode}</div>
        <p style={{ marginTop: 8 }}>{joinUrl(room.roomCode)}</p>
        <div className="row">
          <button className="btn ghost" onClick={onCopy}>
            Copy link
          </button>
        </div>
      </div>
      <div className="card">
        <h2>Players ({room.players.length})</h2>
        {room.players.map((p) => (
          <div key={p.id} className="row" style={{ justifyContent: 'space-between', margin: '6px 0' }}>
            <span>
              {p.name} {p.id === room.hostId ? '· host' : ''} {p.isReady ? '· ready' : ''}
            </span>
            {host && p.id !== selfId ? (
              <button className="btn ghost" onClick={() => onKick(p.id)}>
                Kick
              </button>
            ) : null}
          </div>
        ))}
      </div>
      <div className="card">
        <h2>Host settings</h2>
        <label>Prep (seconds)</label>
        <input
          type="number"
          min={5}
          max={120}
          value={settings.prepSeconds}
          disabled={!host}
          onChange={(e) => onSettings({ ...settings, prepSeconds: Number(e.target.value) })}
        />
        <label>Debate (minutes)</label>
        <input
          type="number"
          min={1}
          max={10}
          value={settings.debateMinutes}
          disabled={!host}
          onChange={(e) => onSettings({ ...settings, debateMinutes: Number(e.target.value) })}
        />
        <label>Speak mode</label>
        <select
          value={settings.speakMode}
          disabled={!host}
          onChange={(e) => onSettings({ ...settings, speakMode: e.target.value as SpeakMode })}
        >
          <option value="timed_turns">Timed turns (default)</option>
          <option value="free_for_all">Free-for-all</option>
        </select>
      </div>
      <div className="row">
        <button className="btn ghost" onClick={() => onReady(!self?.isReady)}>
          {self?.isReady ? 'Unready' : 'Ready'}
        </button>
        {host ? (
          <button className="btn" disabled={!canStart} onClick={onStart}>
            Start
          </button>
        ) : null}
        <button className="btn danger" onClick={onLeave}>
          {host ? 'Close room' : 'Leave'}
        </button>
      </div>
      {error ? <p className="err">{error}</p> : null}
      <AdSlot show />
    </div>
  );
}

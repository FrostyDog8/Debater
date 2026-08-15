import { AdSlot } from '../components/AdSlot';

type Props = {
  name: string;
  code: string;
  error: string | null;
  busy: boolean;
  onName(v: string): void;
  onCode(v: string): void;
  onHost(): void;
  onJoin(): void;
};

export function HomeScreen({ name, code, error, busy, onName, onCode, onHost, onJoin }: Props) {
  return (
    <div className="app">
      <p className="brand">In-room · Discord · phones or PC</p>
      <h1>Debate Roulette</h1>
      <p>
        One person hosts. Everyone else joins with a code. Talk in the room or on a call — this site is only the
        controller.
      </p>
      <div className="card">
        <label>Your name</label>
        <input value={name} onChange={(e) => onName(e.target.value)} placeholder="Alex" maxLength={24} />
        <div className="row" style={{ marginTop: 14 }}>
          <button className="btn" disabled={busy || name.trim().length < 2} onClick={onHost}>
            Host a game
          </button>
        </div>
      </div>
      <div className="card">
        <label>Join with a code</label>
        <input
          value={code}
          onChange={(e) => onCode(e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4))}
          placeholder="ABCD"
          maxLength={4}
        />
        <div className="row" style={{ marginTop: 14 }}>
          <button className="btn ghost" disabled={busy || code.trim().length !== 4 || name.trim().length < 2} onClick={onJoin}>
            Join
          </button>
        </div>
      </div>
      {error ? <p className="err">{error}</p> : null}
      <AdSlot show />
    </div>
  );
}

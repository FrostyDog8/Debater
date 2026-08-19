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
    <div className="app home-screen">
      <h1 className="home-title">Debater</h1>
      <p className="home-lede">Pick a side. Defend it. Let the crowd decide.</p>

      <div className="card fill home-card">
        <div className="home-section">
          <label className="home-label">Your name</label>
          <input
            className="home-input"
            value={name}
            onChange={(e) => onName(e.target.value)}
            placeholder="Alex"
            maxLength={24}
            autoComplete="nickname"
          />
          <button className="btn home-btn" disabled={busy || name.trim().length < 2} onClick={onHost}>
            Host a game
          </button>
        </div>

        <div className="home-divider">
          <span>or</span>
        </div>

        <div className="home-section">
          <label className="home-label">Join with a code</label>
          <input
            className="home-input home-code-input"
            value={code}
            onChange={(e) => onCode(e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4))}
            placeholder="ABCD"
            maxLength={4}
            autoCapitalize="characters"
            autoComplete="off"
          />
          <button
            className="btn ghost home-btn"
            disabled={busy || code.trim().length !== 4 || name.trim().length < 2}
            onClick={onJoin}
          >
            Join
          </button>
        </div>

        
      </div>

      {error ? <p className="err">{error}</p> : null}
      <div className="home-footer">
        Still in development. We are building more rounds, better tools, and new surprises for the future.
      </div>
    </div>
  );
}

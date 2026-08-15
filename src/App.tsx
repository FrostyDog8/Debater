import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  allRequiredPacksIn,
  allSplitsIn,
  allTopicVotesIn,
  createEngine,
  hostContinue,
  MIN_START_PLAYERS,
  parseSettings,
  resolveSplit,
  tickClock,
  type Settings,
} from './lib/engine';
import {
  cloudCreateRoom,
  cloudJoinRoom,
  cloudKickPlayer,
  cloudLeaveRoom,
  cloudPatchGameState,
  cloudPatchLobbySettings,
  cloudReturnToLobby,
  cloudSetReady,
  cloudStartGame,
  cloudSubscribeRoom,
  isLobbyNotFoundError,
  playerInputKey,
  type GamePayload,
} from './lib/cloud';
import { joinUrl, loadName, parseRoomFromHash, roomHash, saveName, type Room } from './lib/session';
import { parsePayload, readInputs, type PlayerInput } from './lib/sync';
import { useAuthUser } from './lib/useAuthUser';
import { HomeScreen } from './screens/HomeScreen';
import { LobbyScreen } from './screens/LobbyScreen';
import { PlayScreen } from './screens/PlayScreen';

export function App() {
  const { user, ready, error: authError } = useAuthUser();
  const [name, setName] = useState(loadName);
  const [code, setCode] = useState('');
  const [room, setRoom] = useState<Room | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const lastHostWrite = useRef('');

  useEffect(() => {
    saveName(name);
  }, [name]);

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(t);
  }, []);

  const attachRoom = useCallback((roomCode: string) => {
    window.location.hash = roomHash(roomCode);
    return cloudSubscribeRoom({
      roomCode,
      onRoom: setRoom,
      onRoomClosed: () => {
        setRoom(null);
        window.location.hash = '';
        setError('Room closed');
      },
      onError: (message) => setError(message),
    });
  }, []);

  useEffect(() => {
    if (!user || !ready) return;
    const fromHash = parseRoomFromHash();
    if (!fromHash) return;
    let sub: { unsubscribe(): void } | null = null;
    (async () => {
      try {
        await cloudJoinRoom({ roomCode: fromHash, userId: user.id, name: name.trim() || 'Player' });
        sub = attachRoom(fromHash);
      } catch (e) {
        setError(isLobbyNotFoundError(e) ? "Lobby doesn't exist" : String((e as Error).message));
      }
    })();
    return () => sub?.unsubscribe();
  }, [user, ready, attachRoom, name]);

  const hostGame = async () => {
    if (!user) return;
    setBusy(true);
    setError(null);
    try {
      const created = await cloudCreateRoom({ hostUserId: user.id, hostName: name.trim() });
      attachRoom(created);
    } catch (e) {
      setError(String((e as Error).message));
    } finally {
      setBusy(false);
    }
  };

  const joinGame = async () => {
    if (!user) return;
    setBusy(true);
    setError(null);
    try {
      await cloudJoinRoom({ roomCode: code, userId: user.id, name: name.trim() });
      attachRoom(code);
    } catch (e) {
      setError(isLobbyNotFoundError(e) ? "Lobby doesn't exist" : String((e as Error).message));
    } finally {
      setBusy(false);
    }
  };

  const settings: Settings = useMemo(() => parseSettings(room?.lobbySettings), [room?.lobbySettings]);
  const ids = room?.players.map((p) => p.id) ?? [];
  const parsed = useMemo(
    () => (room?.status === 'playing' ? parsePayload(room.gameState, ids) : null),
    [room, ids],
  );

  const isHost = !!(user && room && room.hostId === user.id);

  useEffect(() => {
    if (!isHost || !room || room.status !== 'playing' || !parsed) return;
    let next = tickClock(parsed.engine, Date.now());
    if (next.phase === 'collect_packs' && allRequiredPacksIn(next)) next = hostContinue(next, ids);
    if (next.phase === 'collect_final_topics' && allRequiredPacksIn(next)) next = hostContinue(next, ids);
    if (next.phase === 'split_vote' && allSplitsIn(next, ids)) next = resolveSplit(next, ids);
    if (next.phase === 'vote_final_topic' && allTopicVotesIn(next, ids)) next = hostContinue(next, ids);
    const serialized = JSON.stringify(next);
    if (serialized === lastHostWrite.current || serialized === JSON.stringify(parsed.engine)) return;
    lastHostWrite.current = serialized;
    void cloudPatchGameState({ roomCode: room.roomCode, patch: { engine: next }, replace: false }).catch((e) =>
      setError(String((e as Error).message)),
    );
  }, [isHost, room, parsed, ids, now]);

  if (!ready) {
    return (
      <div className="app">
        <p className="brand">Debate Roulette</p>
        <p>Signing in…</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="app">
        <p className="brand">Debate Roulette</p>
        <p className="err">{authError ?? 'Could not start a session.'}</p>
        <p>In Supabase, enable Authentication → Providers → Anonymous.</p>
      </div>
    );
  }

  if (!room) {
    return (
      <HomeScreen
        name={name}
        code={code}
        error={error ?? authError}
        busy={busy}
        onName={setName}
        onCode={setCode}
        onHost={() => void hostGame()}
        onJoin={() => void joinGame()}
      />
    );
  }

  if (room.status === 'lobby') {
    return (
      <LobbyScreen
        room={room}
        selfId={user.id}
        settings={settings}
        error={error}
        onSettings={(next) => {
          void cloudPatchLobbySettings({ roomCode: room.roomCode, hostUserId: user.id, settings: next });
        }}
        onReady={(readyNow) => void cloudSetReady({ roomCode: room.roomCode, userId: user.id, isReady: readyNow })}
        onStart={async () => {
          if (room.players.length < MIN_START_PLAYERS) return;
          const engine = createEngine(
            room.players.map((p) => p.id),
            settings,
          );
          await cloudStartGame({ roomCode: room.roomCode, hostUserId: user.id, gameState: { engine } satisfies GamePayload });
        }}
        onKick={(id) => void cloudKickPlayer({ roomCode: room.roomCode, hostUserId: user.id, targetUserId: id })}
        onLeave={async () => {
          await cloudLeaveRoom({ roomCode: room.roomCode, userId: user.id });
          setRoom(null);
          window.location.hash = '';
        }}
        onCopy={async () => {
          await navigator.clipboard.writeText(joinUrl(room.roomCode));
        }}
      />
    );
  }

  const engine = parsed?.engine ?? createEngine(ids, settings);
  const input: PlayerInput = user ? (readInputs(parsed?.payload, ids)[user.id] ?? {}) : {};

  return (
    <PlayScreen
      room={room}
      selfId={user.id}
      engine={engine}
      input={input}
      error={error}
      now={now}
      onInput={(next) => {
        void cloudPatchGameState({
          roomCode: room.roomCode,
          patch: { [playerInputKey(user.id)]: next },
          replace: false,
        });
      }}
      onHostContinue={() => {
        const next = hostContinue(engine, ids);
        void cloudPatchGameState({ roomCode: room.roomCode, patch: { engine: next }, replace: false });
      }}
      onLeave={async () => {
        await cloudLeaveRoom({ roomCode: room.roomCode, userId: user.id });
        setRoom(null);
        window.location.hash = '';
      }}
      onPlayAgain={async () => {
        await cloudReturnToLobby({ roomCode: room.roomCode, hostUserId: user.id });
      }}
    />
  );
}

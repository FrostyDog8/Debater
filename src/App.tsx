import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  allRequiredPacksIn,
  allSplitsIn,
  allTopicVotesIn,
  createEngine,
  DEFAULT_SETTINGS,
  hostContinue,
  hostPause,
  hostSkipDebate,
  hostUnpause,
  isPaused,
  lockFinalTopicPick,
  MIN_START_PLAYERS,
  parseSettings,
  resolveSplit,
  schedulePairedStage,
  skipRestOfRound,
  tickClock,
  type Settings,
} from './lib/engine';
import {
  cloudCreateRoom,
  cloudFetchRoom,
  cloudJoinRoom,
  cloudKickPlayer,
  cloudLeaveRoom,
  cloudPatchGameState,
  cloudPatchLobbySettings,
  cloudRename,
  cloudReturnToLobby,
  cloudSetReady,
  cloudStartGame,
  cloudSubscribeRoom,
  cloudRecordTopic,
  isLobbyNotFoundError,
  playerInputKey,
  type GamePayload,
} from './lib/cloud';
import { joinUrl, loadName, parseRoomFromHash, roomHash, saveName, type Room } from './lib/session';
import { parsePayload, readInputs, wipeSplitsKeepClaps, wipedInputs, type PlayerInput } from './lib/sync';
import { roomParams, trackEvent } from './lib/analytics';
import { useAuthUser } from './lib/useAuthUser';
import { HomeScreen } from './screens/HomeScreen';
import { LobbyScreen } from './screens/LobbyScreen';
import { PlayScreen } from './screens/PlayScreen';

function stampSettings(settings: Settings) {
  return { ...settings, updatedAt: Date.now() };
}

function newerLobbySettings(current: unknown, incoming: unknown): unknown {
  if (incoming == null) return current ?? null;
  if (current == null) return incoming;
  const curAt = Number((current as { updatedAt?: number }).updatedAt) || 0;
  const inAt = Number((incoming as { updatedAt?: number }).updatedAt) || 0;
  return inAt >= curAt ? incoming : current;
}

export function App() {
  const { user, ready, error: authError } = useAuthUser();
  const [name, setName] = useState(loadName);
  const [code, setCode] = useState('');
  const [room, setRoom] = useState<Room | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [hostSettings, setHostSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const lastHostWrite = useRef('');
  const lastPhaseKey = useRef('');
  const trackedPhaseKey = useRef('');
  const recordedPackIds = useRef(new Set<string>());
  const roomSub = useRef<ReturnType<typeof cloudSubscribeRoom> | null>(null);
  const settingsTimer = useRef<number | null>(null);
  const hostSettingsRef = useRef(hostSettings);
  const roomRef = useRef<Room | null>(null);
  const userIdRef = useRef<string | null>(null);
  const seededHostRoom = useRef('');
  const attachedCode = useRef('');
  const blockedJoinCode = useRef('');
  const leavingRef = useRef(false);
  const syncEpoch = useRef(0);
  const awaitLobbyAck = useRef(false);
  const nameRef = useRef(name);
  hostSettingsRef.current = hostSettings;
  nameRef.current = name;

  useEffect(() => {
    saveName(name);
  }, [name]);

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(t);
  }, []);

  useEffect(() => {
    // The lab renders each device as `/?seat=N`.
    // Enable automation only inside those lab iframes.
    let seat = '';
    try {
      seat = new URLSearchParams(window.location.search).get('seat') ?? '';
    } catch {
      seat = '';
    }
    if (!seat) return;
    const ch = new BroadcastChannel('lab:autofill');
    ch.onmessage = (
      ev: MessageEvent<
        | { seat?: number; topic: string; stanceA: string; stanceB: string }
        | { seat?: number; splitA: number }
        | { skipRound: true }
      >,
    ) => {
      const uid = userIdRef.current;
      const r = roomRef.current;
      if (!uid || !r) return;
      const currentPhase = (window as unknown as Record<string, unknown>).__LAB_PHASE__;
      const data = ev.data;
      if (data && 'skipRound' in data && data.skipRound) {
        if (r.hostId !== uid || r.status !== 'playing') return;
        const playerIds = r.players.map((p) => p.id);
        const { engine: current } = parsePayload(r.gameState, playerIds);
        const next = skipRestOfRound(current, playerIds);
        lastPhaseKey.current = `${next.phase}:${next.matchIndex}:${next.stageKind}`;
        lastHostWrite.current = JSON.stringify(next);
        void cloudPatchGameState({
          roomCode: r.roomCode,
          patch: { engine: next, ...wipedInputs(playerIds) },
          replace: false,
        });
        return;
      }
      const mySeat = Number(seat);
      if (data && typeof (data as { seat?: number }).seat === 'number' && (data as { seat: number }).seat !== mySeat) {
        return;
      }
      if (data && 'topic' in data && typeof data.topic === 'string') {
        if (currentPhase !== 'collect_packs' && currentPhase !== 'collect_final_topics') return;
        void cloudPatchGameState({
          roomCode: r.roomCode,
          patch: { [playerInputKey(uid)]: { pack: { topic: data.topic, stanceA: data.stanceA, stanceB: data.stanceB } } },
          replace: false,
        });
        return;
      }
      if (data && 'splitA' in data && typeof data.splitA === 'number') {
        if (currentPhase !== 'split_vote') return;
        void cloudPatchGameState({
          roomCode: r.roomCode,
          patch: { [playerInputKey(uid)]: { splitA: data.splitA } },
          replace: false,
        });
      }
    };
    return () => ch.close();
  }, []);

  const attachRoom = useCallback((roomCode: string) => {
    const code = roomCode.trim().toUpperCase();
    attachedCode.current = code;
    window.location.hash = roomHash(code);
    roomSub.current?.unsubscribe();
    const sub = cloudSubscribeRoom({
      roomCode,
      onRoom: (next) => {
        const uid = userIdRef.current;
        setRoom((prev) => {
          const hostStillInRoom = next.players.some((p) => p.id === next.hostId);
          if (!hostStillInRoom) {
            if (!leavingRef.current) setError('The host left — this room is closed. Host a new game or join another code.');
            blockedJoinCode.current = next.roomCode;
            attachedCode.current = '';
            roomRef.current = null;
            seededHostRoom.current = '';
            window.location.hash = '';
            queueMicrotask(() => {
              roomSub.current?.unsubscribe();
              roomSub.current = null;
            });
            return null;
          }
          const wasIn = !!uid && !!prev?.players.some((p) => p.id === uid);
          const isIn = !!uid && next.players.some((p) => p.id === uid);
          if (wasIn && !isIn && !leavingRef.current) {
            blockedJoinCode.current = next.roomCode;
            attachedCode.current = '';
            roomRef.current = null;
            seededHostRoom.current = '';
            window.location.hash = '';
            setError('You were removed from the room. Ask the host for a new invite, or join with a different code.');
            queueMicrotask(() => {
              roomSub.current?.unsubscribe();
              roomSub.current = null;
            });
            return null;
          }
          const merged = {
            ...next,
            // Never keep a stale game payload once the room is back in lobby.
            gameState: next.status === 'lobby' ? null : next.gameState,
            lobbySettings: newerLobbySettings(prev?.lobbySettings, next.lobbySettings),
          };
          if (awaitLobbyAck.current) {
            if (next.status === 'lobby') {
              awaitLobbyAck.current = false;
            } else if (next.status === 'playing') {
              const enginePhase =
                next.gameState &&
                typeof next.gameState === 'object' &&
                (next.gameState as { engine?: { phase?: string } }).engine?.phase;
              // Accept only a fresh match (host started again); ignore late champion ticks.
              if (enginePhase === 'collect_packs' || enginePhase === 'collect_final_topics') {
                awaitLobbyAck.current = false;
              } else {
                const stay = {
                  ...prev!,
                  status: 'lobby' as const,
                  gameState: null,
                  lobbySettings: newerLobbySettings(prev?.lobbySettings, next.lobbySettings),
                  players: next.players,
                };
                roomRef.current = stay;
                return stay;
              }
            }
          }
          roomRef.current = merged;
          return merged;
        });
      },
      onLobbySettings: (raw) => {
        setRoom((prev) => {
          if (!prev) return prev;
          const merged = { ...prev, lobbySettings: newerLobbySettings(prev.lobbySettings, raw) };
          roomRef.current = merged;
          return merged;
        });
      },
      onReturnToLobby: (raw) => {
        syncEpoch.current += 1;
        awaitLobbyAck.current = true;
        lastHostWrite.current = '';
        lastPhaseKey.current = '';
        trackedPhaseKey.current = '';
        recordedPackIds.current = new Set();
        setRoom((prev) => {
          if (!prev) return prev;
          const merged = {
            ...prev,
            status: 'lobby' as const,
            gameState: null,
            lobbySettings: newerLobbySettings(prev.lobbySettings, raw),
          };
          roomRef.current = merged;
          return merged;
        });
      },
      onSettingsRequested: () => {
        const current = roomRef.current;
        const uid = userIdRef.current;
        if (!current || !uid || current.hostId !== uid || current.status !== 'lobby') return;
        sub.publishLobbySettings(stampSettings(hostSettingsRef.current));
      },
      onRoomClosed: () => {
        blockedJoinCode.current = attachedCode.current;
        attachedCode.current = '';
        roomRef.current = null;
        seededHostRoom.current = '';
        setRoom(null);
        window.location.hash = '';
        setError('This room closed or expired. Host a new game or join with a new code.');
      },
      onError: (message) => {
        if (message === 'Realtime channel error') {
          setError('Connection hiccup — retrying. If this sticks, refresh the page.');
          return;
        }
        setError(message);
      },
    });
    roomSub.current = sub;
    return sub;
  }, []);

  useEffect(() => {
    if (!user || !ready) return;
    let sub: { unsubscribe(): void } | null = null;
    let cancelled = false;

    const joinFromHash = async () => {
      const fromHash = parseRoomFromHash();
      if (!fromHash) return;
      if (fromHash === 'TEST') {
        trackEvent('open_lab', { source: 'hash' });
        window.location.href = `${import.meta.env.BASE_URL}lab.html`;
        return;
      }
      if (blockedJoinCode.current === fromHash) return;
      if (attachedCode.current === fromHash) return;
      attachedCode.current = fromHash;
      leavingRef.current = false;
      try {
        await cloudJoinRoom({ roomCode: fromHash, userId: user.id, name: nameRef.current.trim() || 'Player' });
        if (cancelled) return;
        trackEvent('room_joined', { room_code: fromHash, source: 'link' });
        sub?.unsubscribe();
        sub = attachRoom(fromHash);
      } catch (e) {
        if (attachedCode.current === fromHash) attachedCode.current = '';
        if (!cancelled) {
          trackEvent('join_failed', {
            room_code: fromHash,
            source: 'link',
            reason: isLobbyNotFoundError(e) ? 'not_found' : 'error',
          });
          setError(isLobbyNotFoundError(e) ? "That lobby code wasn't found. Check the code, or ask the host for a fresh link." : String((e as Error).message));
        }
      }
    };

    void joinFromHash();
    window.addEventListener('hashchange', joinFromHash);
    return () => {
      cancelled = true;
      window.removeEventListener('hashchange', joinFromHash);
      sub?.unsubscribe();
    };
  }, [user, ready, attachRoom]);

  const hostGame = async () => {
    if (!user) return;
    setBusy(true);
    setError(null);
    try {
      const created = await cloudCreateRoom({ hostUserId: user.id, hostName: name.trim() });
      leavingRef.current = false;
      blockedJoinCode.current = '';
      setHostSettings(DEFAULT_SETTINGS);
      seededHostRoom.current = created;
      trackEvent('room_created', { room_code: created });
      attachRoom(created);
    } catch (e) {
      trackEvent('room_create_failed', { reason: 'error' });
      setError(String((e as Error).message));
    } finally {
      setBusy(false);
    }
  };

  const joinGame = async () => {
    if (!user) return;
    const codeUpper = code.trim().toUpperCase();
    if (codeUpper === 'TEST') {
      trackEvent('open_lab', { source: 'code' });
      window.location.href = `${import.meta.env.BASE_URL}lab.html`;
      return;
    }
    setBusy(true);
    setError(null);
    try {
      leavingRef.current = false;
      blockedJoinCode.current = '';
      await cloudJoinRoom({ roomCode: codeUpper, userId: user.id, name: name.trim() });
      trackEvent('room_joined', { room_code: codeUpper, source: 'code' });
      attachRoom(code);
    } catch (e) {
      trackEvent('join_failed', {
        room_code: codeUpper,
        source: 'code',
        reason: isLobbyNotFoundError(e) ? 'not_found' : 'error',
      });
      setError(isLobbyNotFoundError(e) ? "That lobby code wasn't found. Check the code, or ask the host for a fresh link." : String((e as Error).message));
    } finally {
      setBusy(false);
    }
  };

  const remoteSettings = useMemo(() => parseSettings(room?.lobbySettings), [room?.lobbySettings]);
  const isHost = !!(user && room && room.hostId === user.id);
  const settings = isHost && room?.status === 'lobby' ? hostSettings : remoteSettings;
  const ids = room?.players.map((p) => p.id) ?? [];
  const parsed = useMemo(
    () => (room?.status === 'playing' ? parsePayload(room.gameState, ids) : null),
    [room, ids],
  );
  roomRef.current = room;
  userIdRef.current = user?.id ?? null;

  useEffect(() => {
    if (!room) {
      seededHostRoom.current = '';
      return;
    }
    if (!isHost || room.status !== 'lobby') return;
    if (seededHostRoom.current === room.roomCode) return;
    seededHostRoom.current = room.roomCode;
    if (room.lobbySettings != null) setHostSettings(parseSettings(room.lobbySettings));
  }, [isHost, room]);

  useEffect(() => {
    if (!isHost || room?.status !== 'lobby') return;
    const stamped = stampSettings(hostSettings);
    roomSub.current?.publishLobbySettings(stamped);
    if (settingsTimer.current) window.clearTimeout(settingsTimer.current);
    settingsTimer.current = window.setTimeout(() => {
      if (!room) return;
      void cloudPatchLobbySettings({ roomCode: room.roomCode, hostUserId: room.hostId, settings: stamped }).catch((e) => {
        const msg = String((e as Error).message ?? e);
        if (/could not find the function|lobby_settings/i.test(msg)) return;
        setError(msg);
      });
    }, 200);
  }, [isHost, room?.status, room?.players.length, room?.roomCode, room?.hostId, hostSettings]);

  useEffect(() => {
    if (!isHost || !room || room.status !== 'playing' || !parsed) return;
    const epoch = syncEpoch.current;
    const previousPhase = parsed.engine.phase;
    let next = tickClock(parsed.engine, Date.now());
    if (next.phase === 'collect_packs' && allRequiredPacksIn(next, ids) && next.matches.length === 0) {
      next = schedulePairedStage(next);
    }
    if (next.phase === 'split_vote' && previousPhase === 'split_vote' && allSplitsIn(next, ids)) {
      next = resolveSplit(next, ids);
    }
    if (next.phase === 'vote_final_topic' && !next.finalSelectedPackId && allTopicVotesIn(next, ids)) {
      next = lockFinalTopicPick(next, ids);
    }
    const phaseKey = `${next.phase}:${next.matchIndex}:${next.stageKind}`;
    const serialized = JSON.stringify(next);
    if (serialized === lastHostWrite.current || serialized === JSON.stringify(parsed.engine)) return;
    lastHostWrite.current = serialized;
    const patch: GamePayload = { engine: next };
    if (phaseKey !== lastPhaseKey.current) {
      lastPhaseKey.current = phaseKey;
      if (next.phase === 'prep' || next.phase === 'collect_packs' || next.phase === 'collect_final_topics' || next.phase === 'vote_final_topic') {
        Object.assign(patch, wipedInputs(ids));
      } else if (next.phase === 'split_vote') {
        Object.assign(patch, wipeSplitsKeepClaps(parsed.payload, ids));
      }
    }
    void cloudPatchGameState({ roomCode: room.roomCode, patch, replace: false })
      .then(() => {
        if (epoch !== syncEpoch.current) return;
      })
      .catch((e) => {
        if (epoch !== syncEpoch.current) return;
        setError(String((e as Error).message));
      });
  }, [isHost, room, parsed, ids, now]);

  useEffect(() => {
    if (isHost || !room) return;
    const code = room.roomCode;
    const t = window.setInterval(() => {
      void cloudFetchRoom(code)
        .then((fresh) => {
          setRoom((prev) => {
            if (!prev || prev.roomCode !== fresh.roomCode) return prev;
            if (JSON.stringify(prev.gameState) === JSON.stringify(fresh.gameState) && prev.status === fresh.status) {
              const lobbySame =
                JSON.stringify(prev.lobbySettings) === JSON.stringify(fresh.lobbySettings);
              if (lobbySame) return prev;
            }
            let next = fresh;
            if (awaitLobbyAck.current) {
              if (fresh.status === 'lobby') {
                awaitLobbyAck.current = false;
              } else if (fresh.status === 'playing') {
                const enginePhase =
                  fresh.gameState &&
                  typeof fresh.gameState === 'object' &&
                  (fresh.gameState as { engine?: { phase?: string } }).engine?.phase;
                if (enginePhase === 'collect_packs' || enginePhase === 'collect_final_topics') {
                  awaitLobbyAck.current = false;
                } else {
                  next = { ...fresh, status: 'lobby', gameState: null };
                }
              }
            }
            const merged = {
              ...next,
              gameState: next.status === 'lobby' ? null : next.gameState,
              lobbySettings: newerLobbySettings(prev.lobbySettings, next.lobbySettings),
            };
            roomRef.current = merged;
            return merged;
          });
        })
        .catch(() => {
          /* realtime path will keep trying */
        });
    }, 900);
    return () => window.clearInterval(t);
  }, [isHost, room?.roomCode]);

  useEffect(() => {
    if (!room || room.status !== 'playing' || !parsed) {
      if (!room || room.status !== 'playing') trackedPhaseKey.current = '';
      return;
    }
    const e = parsed.engine;
    const key = `${e.phase}:${e.matchIndex}:${e.stageKind}:${e.championId ?? ''}`;
    if (trackedPhaseKey.current === key) return;
    trackedPhaseKey.current = key;
    trackEvent('phase_enter', {
      ...roomParams(room),
      phase: e.phase,
      stage: e.stageKind,
      match_index: e.matchIndex,
      active_players: e.activeIds.length,
      topic_count: e.packPool.length,
    });
    if (e.phase === 'champion') {
      trackEvent('champion_crowned', {
        ...roomParams(room),
        stage: e.stageKind,
        topic_count: e.packPool.length,
      });
    }
  }, [room, parsed]);

  // Host-only: archive each pack once when it enters the engine (avoids N duplicate rows).
  useEffect(() => {
    if (!isHost || !room?.gameId || !parsed) return;
    const gameId = room.gameId;
    for (const pack of parsed.engine.packPool) {
      const key = `${gameId}:${pack.id}`;
      if (recordedPackIds.current.has(key)) continue;
      recordedPackIds.current.add(key);
      const authorName = room.players.find((p) => p.id === pack.authorId)?.name;
      trackEvent('topic_submitted', {
        ...roomParams(room),
        phase: parsed.engine.phase,
        topic_count: parsed.engine.packPool.length,
      });
      void cloudRecordTopic({
        gameId,
        roomCode: room.roomCode,
        packId: pack.id,
        topic: pack.topic,
        stanceA: pack.stanceA,
        stanceB: pack.stanceB,
        suggestedBy: pack.authorId,
        suggestedByName: authorName,
      }).catch(() => {
        /* topic archive should not block play */
      });
    }
  }, [isHost, room, parsed]);

  if (!ready) {
    return (
      <div className="app">
        <p className="brand">Debater</p>
        <p>Signing in…</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="app">
        <p className="brand">Debater</p>
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
        onSettings={(next) => setHostSettings(next)}
        onReady={(readyNow) => void cloudSetReady({ roomCode: room.roomCode, userId: user.id, isReady: readyNow })}
        onStart={async () => {
          if (room.players.length < MIN_START_PLAYERS) return;
          const engine = createEngine(
            room.players.map((p) => p.id),
            settings,
          );
          await cloudStartGame({ roomCode: room.roomCode, hostUserId: user.id, gameState: { engine } satisfies GamePayload });
          trackEvent('game_started', {
            ...roomParams(room),
            player_count: room.players.length,
            prep_seconds: settings.prepSeconds,
            debate_seconds: settings.debateSeconds,
            speak_mode: settings.speakMode,
            topic_count: 0,
          });
        }}
        onKick={(id) => {
          trackEvent('player_kicked', roomParams(room));
          void cloudKickPlayer({ roomCode: room.roomCode, hostUserId: user.id, targetUserId: id });
        }}
        onLeave={async () => {
          trackEvent('leave_room', { ...roomParams(room), from: 'lobby', was_host: isHost });
          leavingRef.current = true;
          blockedJoinCode.current = room.roomCode;
          await cloudLeaveRoom({ roomCode: room.roomCode, userId: user.id });
          seededHostRoom.current = '';
          attachedCode.current = '';
          roomRef.current = null;
          setRoom(null);
          window.location.hash = '';
        }}
        onCopy={async () => {
          await navigator.clipboard.writeText(joinUrl(room.roomCode));
          trackEvent('invite_copied', roomParams(room));
        }}
        onName={(next) => {
          setName(next);
          void cloudRename({ roomCode: room.roomCode, userId: user.id, name: next }).catch((e) => {
            setError(String((e as Error).message));
          });
        }}
      />
    );
  }

  const baseEngine = parsed?.engine ?? createEngine(ids, settings);
  // Non-host clients don't run the authoritative tick loop.
  // Applying `tickClock` here makes the UI keep moving even if realtime updates hitch.
  const engine = isHost ? baseEngine : tickClock(baseEngine, now);
  const input: PlayerInput = user ? (readInputs(parsed?.payload, ids)[user.id] ?? {}) : {};

  // Let `LabScreen` know what phase each lab device is in.
  // This is used to enable/disable the auto-fill button.
  try {
    const seat = new URLSearchParams(window.location.search).get('seat');
    if (seat) (window as unknown as Record<string, unknown>).__LAB_PHASE__ = engine.phase;
  } catch {
    /* ignore */
  }

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
        if (typeof next.splitA === 'number' && input.splitA == null) {
          trackEvent('split_vote_locked', {
            ...roomParams(room),
            split_a: next.splitA,
            stage: engine.stageKind,
            topic_count: engine.packPool.length,
          });
        }
        if (next.topicVote && !input.topicVote) {
          trackEvent('final_topic_voted', {
            ...roomParams(room),
            topic_count: engine.packPool.length,
          });
        }
      }}
      onHostContinue={() => {
        const next = hostContinue(engine, ids);
        trackEvent('host_continue', {
          ...roomParams(room),
          from_phase: engine.phase,
          to_phase: next.phase,
          stage: engine.stageKind,
        });
        const patch: GamePayload = { engine: next };
        if (
          next.phase === 'prep' ||
          next.phase === 'collect_packs' ||
          next.phase === 'collect_final_topics' ||
          next.phase === 'vote_final_topic'
        ) {
          Object.assign(patch, wipedInputs(ids));
        } else if (next.phase === 'split_vote') {
          Object.assign(patch, wipeSplitsKeepClaps(parsed?.payload, ids));
        }
        lastPhaseKey.current = `${next.phase}:${next.matchIndex}:${next.stageKind}`;
        void cloudPatchGameState({ roomCode: room.roomCode, patch, replace: false });
      }}
      onHostPause={() => {
        const pausing = !isPaused(engine);
        const next = pausing ? hostPause(engine, Date.now()) : hostUnpause(engine, Date.now());
        trackEvent(pausing ? 'host_pause' : 'host_unpause', {
          ...roomParams(room),
          phase: engine.phase,
        });
        lastHostWrite.current = JSON.stringify(next);
        void cloudPatchGameState({ roomCode: room.roomCode, patch: { engine: next }, replace: false });
      }}
      onHostSkip={() => {
        const next = hostSkipDebate(engine);
        trackEvent('host_skip_to_vote', {
          ...roomParams(room),
          from_phase: engine.phase,
          stage: engine.stageKind,
        });
        lastPhaseKey.current = `${next.phase}:${next.matchIndex}:${next.stageKind}`;
        lastHostWrite.current = JSON.stringify(next);
        const patch: GamePayload = { engine: next };
        Object.assign(patch, wipeSplitsKeepClaps(parsed?.payload, ids));
        void cloudPatchGameState({ roomCode: room.roomCode, patch, replace: false });
      }}
      onLeave={async () => {
        trackEvent('leave_room', { ...roomParams(room), from: 'play', was_host: isHost });
        leavingRef.current = true;
        blockedJoinCode.current = room.roomCode;
        await cloudLeaveRoom({ roomCode: room.roomCode, userId: user.id });
        seededHostRoom.current = '';
        attachedCode.current = '';
        roomRef.current = null;
        setRoom(null);
        window.location.hash = '';
      }}
      onPlayAgain={async () => {
        trackEvent('play_again', { ...roomParams(room), topic_count: engine.packPool.length });
        syncEpoch.current += 1;
        awaitLobbyAck.current = true;
        recordedPackIds.current = new Set();
        lastHostWrite.current = '';
        lastPhaseKey.current = '';
        trackedPhaseKey.current = '';
        const stamped = stampSettings(hostSettings);
        setHostSettings(parseSettings(stamped));
        seededHostRoom.current = room.roomCode;
        setRoom((prev) => {
          if (!prev) return prev;
          const merged = {
            ...prev,
            status: 'lobby' as const,
            gameState: null,
            lobbySettings: stamped,
          };
          roomRef.current = merged;
          return merged;
        });
        // Tell guests immediately so they leave the champion screen before the DB round-trip.
        roomSub.current?.publishReturnToLobby(stamped);
        roomSub.current?.publishLobbySettings(stamped);
        await cloudReturnToLobby({ roomCode: room.roomCode, hostUserId: user.id, settings: stamped });
        awaitLobbyAck.current = false;
        roomSub.current?.publishLobbySettings(stamped);
        roomSub.current?.publishReturnToLobby(stamped);
      }}
    />
  );
}

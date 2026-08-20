import { useEffect, useState } from 'react';

const KEY = 'debate-roulette-lab-count';

const RANDOM_TOPICS = [
  ['Pineapple on pizza', 'Yes, it belongs', 'Absolute culinary crime'],
  ['Naps are productive', 'Rest is efficiency', 'Napping is laziness'],
  ['Cats > Dogs', 'Cats are superior', 'Dogs are clearly better'],
  ['Space tourism', 'Open the cosmos', 'Stay on Earth'],
  ['Morning people win', 'Early birds thrive', 'Night owls rule'],
  ['AI is good', 'Progress, embrace it', 'Pandora\'s box, close it'],
  ['Remote work forever', 'Office is obsolete', 'In-person is essential'],
  ['Social media is harmful', 'Ban the scrolling', 'It connects us all'],
  ['Math is beautiful', 'Elegant and pure', 'Tedious and overrated'],
  ['Cereal before milk', 'Obviously cereal first', 'Milk goes in first'],
];

function randomPack(seat: number) {
  const idx = (seat + Math.floor(Math.random() * RANDOM_TOPICS.length)) % RANDOM_TOPICS.length;
  const t = RANDOM_TOPICS[idx]!;
  return { topic: t[0]!, stanceA: t[1]!, stanceB: t[2]! };
}

function randomSplitVote() {
  return { splitA: Math.floor(Math.random() * 11) };
}

const BASE = import.meta.env.BASE_URL || '/';

function appUrl(seat: number, roomCode?: string): string {
  const path = `${BASE.replace(/\/?$/, '/')}?seat=${seat}`;
  return roomCode ? `${path}#/r/${roomCode}` : path;
}

function parseCode(hash: string): string {
  const m = String(hash || '').match(/#\/r\/([A-Za-z]{4})/i);
  return m ? m[1]!.toUpperCase() : '';
}

export function LabScreen() {
  const saved = Number(sessionStorage.getItem(KEY) || '3');
  const [count, setCount] = useState(Math.min(8, Math.max(1, saved)));
  const [code, setCode] = useState('');
  const [fillNote, setFillNote] = useState('');
  const [phase, setPhase] = useState('');

  useEffect(() => {
    sessionStorage.setItem(KEY, String(count));
  }, [count]);

  useEffect(() => {
    const tick = window.setInterval(() => {
      const first = document.querySelector<HTMLIFrameElement>('#lab-stage iframe');
      try {
        setCode(parseCode(first?.contentWindow?.location.hash ?? ''));
        const p = (first?.contentWindow as unknown as Record<string, unknown>)?.__LAB_PHASE__;
        setPhase(typeof p === 'string' ? p : '');
      } catch {
        setCode('');
        setPhase('');
      }
    }, 250);
    return () => window.clearInterval(tick);
  }, [count]);

  const autofillTopics = () => {
    const ch = new BroadcastChannel('lab:autofill');
    for (let i = 0; i < count; i++) {
      ch.postMessage({ seat: i + 1, ...randomPack(i) });
    }
    ch.close();
  };

  const autofillVotes = () => {
    const ch = new BroadcastChannel('lab:autofill');
    for (let i = 0; i < count; i++) {
      ch.postMessage({ seat: i + 1, ...randomSplitVote() });
    }
    ch.close();
  };

  const skipRound = () => {
    const ch = new BroadcastChannel('lab:autofill');
    ch.postMessage({ skipRound: true });
    ch.close();
  };

  const fill = () => {
    const frames = [...document.querySelectorAll<HTMLIFrameElement>('#lab-stage iframe')];
    const room = code || parseCode(frames[0]?.contentWindow?.location.hash ?? '');
    if (!room) {
      setFillNote('Host a room on device 1 first.');
      return;
    }
    const others = frames.slice(1);
    others.forEach((frame, i) => {
      const seat = i + 2;
      frame.src = appUrl(seat, room);
    });
    setFillNote(`Sent ${room} to ${others.length} device${others.length === 1 ? '' : 's'}.`);
    window.setTimeout(() => setFillNote((cur) => (cur.startsWith('Sent ') ? '' : cur)), 2500);
  };

  return (
    <div className="lab-shell">
      <div className="lab-bar">
        <strong>Lab</strong>
        <label>
          Devices
          <select value={count} onChange={(e) => setCount(Number(e.target.value))}>
            {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <span>Host on 1, then fill the others.</span>
        <span>
          Room <b>{code || '—'}</b>
        </span>
        <button disabled={!code} onClick={fill}>
          Fill code on other devices
        </button>
        <button
          disabled={phase !== 'collect_packs' && phase !== 'collect_final_topics'}
          onClick={autofillTopics}
        >
          Auto-fill topics
        </button>
        <button disabled={phase !== 'split_vote'} onClick={autofillVotes}>
          Auto-fill votes
        </button>
        <button
          disabled={
            phase !== 'prep' && phase !== 'debate' && phase !== 'split_vote' && phase !== 'match_result'
          }
          onClick={skipRound}
        >
          Skip round
        </button>
        {fillNote ? <span className="lab-fill-note">{fillNote}</span> : null}
        <a href={BASE}>Back</a>
      </div>
      <div id="lab-stage" className={`lab-stage n${count}`}>
        {Array.from({ length: count }, (_, i) => i + 1).map((n) => (
          <section key={n} className="lab-device">
            <header>
              <span>Device {n}</span>
              <span>Player {n}</span>
            </header>
            <iframe title={`Device ${n}`} src={appUrl(n)} />
          </section>
        ))}
      </div>
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import { CLAP_COOLDOWN_MS } from '../lib/engine';

export type ClapBurst = { key: string; side: 'A' | 'B'; slot: number; at: number };

function sum(map: Record<string, number>): number {
  return Object.values(map).reduce((s, n) => s + n, 0);
}

export function useClapBursts(clapA: Record<string, number>, clapB: Record<string, number>): ClapBurst[] {
  const prev = useRef({ a: 0, b: 0, primed: false });
  const slot = useRef(0);
  const [bursts, setBursts] = useState<ClapBurst[]>([]);

  useEffect(() => {
    const a = sum(clapA);
    const b = sum(clapB);
    if (!prev.current.primed) {
      prev.current = { a, b, primed: true };
      return;
    }
    const da = Math.max(0, a - prev.current.a);
    const db = Math.max(0, b - prev.current.b);
    prev.current = { a, b, primed: true };
    if (!da && !db) return;
    const at = Date.now();
    const next: ClapBurst[] = [];
    for (let i = 0; i < da; i++) next.push({ key: `a-${slot.current}`, side: 'A', slot: slot.current++, at });
    for (let i = 0; i < db; i++) next.push({ key: `b-${slot.current}`, side: 'B', slot: slot.current++, at });
    setBursts((cur) => [...cur, ...next]);
  }, [clapA, clapB]);

  useEffect(() => {
    if (!bursts.length) return;
    const t = window.setInterval(() => {
      const cutoff = Date.now() - CLAP_COOLDOWN_MS;
      setBursts((cur) => {
        const keep = cur.filter((burst) => burst.at > cutoff);
        return keep.length === cur.length ? cur : keep;
      });
    }, 200);
    return () => window.clearInterval(t);
  }, [bursts.length]);

  return bursts;
}

export function ClapBursts({
  bursts,
  className,
  rail,
}: {
  bursts: ClapBurst[];
  className?: string;
  rail?: 'top' | 'bottom';
}) {
  const shown =
    rail === 'top' ? bursts.filter((burst) => burst.slot % 2 === 0) : rail === 'bottom' ? bursts.filter((burst) => burst.slot % 2 === 1) : bursts;
  return (
    <div className={className ?? 'clap-space'} aria-hidden>
      {shown.map((burst) => (
        <span key={burst.key} className={`clap-burst for-${burst.side === 'A' ? 'a' : 'b'} slot-${burst.slot % 4}`}>
          👏
        </span>
      ))}
    </div>
  );
}

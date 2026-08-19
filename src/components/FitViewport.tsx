import { useLayoutEffect, useRef, type ReactNode } from 'react';

export function FitViewport({ children }: { children: ReactNode }) {
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const outer = outerRef.current;
    const inner = innerRef.current;
    if (!outer || !inner) return;

    const apply = () => {
      inner.style.transform = 'scale(1)';
      const next = Math.min(
        1,
        outer.clientHeight / Math.max(inner.scrollHeight, 1),
        outer.clientWidth / Math.max(inner.scrollWidth, 1),
      );
      inner.style.transform = `scale(${Number.isFinite(next) && next > 0 ? next : 1})`;
    };

    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(outer);
    ro.observe(inner);
    window.addEventListener('resize', apply);
    window.visualViewport?.addEventListener('resize', apply);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', apply);
      window.visualViewport?.removeEventListener('resize', apply);
    };
  }, []);

  return (
    <div className="fit-outer" ref={outerRef}>
      <div className="fit-inner" ref={innerRef}>
        {children}
      </div>
    </div>
  );
}

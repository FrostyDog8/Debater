const GA_ID = (import.meta.env.VITE_GA_MEASUREMENT_ID ?? '').trim();

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

export type AnalyticsParams = Record<string, string | number | boolean | undefined>;

/** Load GA4 when `VITE_GA_MEASUREMENT_ID` is set. Safe no-op otherwise. */
export function initAnalytics() {
  if (!GA_ID || typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.gtag) return;

  window.dataLayer = window.dataLayer || [];
  window.gtag = function gtag(...args: unknown[]) {
    window.dataLayer?.push(args);
  };
  window.gtag('js', new Date());
  window.gtag('config', GA_ID, { send_page_view: true });

  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(GA_ID)}`;
  document.head.appendChild(script);
}

function cleanParams(params?: AnalyticsParams): Record<string, string | number | boolean> | undefined {
  if (!params) return undefined;
  const out: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    out[key] = value;
  }
  return Object.keys(out).length ? out : undefined;
}

export function trackEvent(eventName: string, params?: AnalyticsParams) {
  if (!GA_ID || typeof window === 'undefined' || !window.gtag) return;
  window.gtag('event', eventName, cleanParams(params));
}

export function analyticsConfigured(): boolean {
  return !!GA_ID;
}

/** Shared room context for game events (no player names / PII). */
export function roomParams(room: { gameId?: string | null; roomCode?: string; players?: { length: number } }) {
  return {
    game_id: room.gameId ?? undefined,
    room_code: room.roomCode ?? undefined,
    player_count: room.players?.length,
  };
}

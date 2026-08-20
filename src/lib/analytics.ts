const GA_ID = (import.meta.env.VITE_GA_MEASUREMENT_ID ?? '').trim();

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

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

export function trackEvent(eventName: string, params?: Record<string, string | number | boolean>) {
  if (!GA_ID || typeof window === 'undefined' || !window.gtag) return;
  window.gtag('event', eventName, params);
}

export function analyticsConfigured(): boolean {
  return !!GA_ID;
}

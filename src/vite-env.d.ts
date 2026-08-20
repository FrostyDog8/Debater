/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  readonly VITE_ADSENSE_CLIENT?: string;
  readonly VITE_ADSENSE_SLOT?: string;
  readonly VITE_BASE?: string;
  /** Google Analytics 4 measurement ID, e.g. G-XXXXXXXXXX */
  readonly VITE_GA_MEASUREMENT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

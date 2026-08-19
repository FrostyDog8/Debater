import { createClient } from '@supabase/supabase-js';
import { labSeat } from './session';

const url = (import.meta.env.VITE_SUPABASE_URL ?? '').trim();
const anon = (import.meta.env.VITE_SUPABASE_ANON_KEY ?? '').trim();
const seat = labSeat();

export const supabase = createClient(url, anon, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: !seat,
    storage: seat ? window.sessionStorage : window.localStorage,
    ...(seat ? { storageKey: `debate-roulette-auth-${seat}` } : {}),
  },
});

import { useEffect, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase } from './supabase';

export function useAuthUser() {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (data.session?.user) {
        if (alive) {
          setUser(data.session.user);
          setReady(true);
        }
        return;
      }
      const anon = await supabase.auth.signInAnonymously();
      if (anon.error) {
        if (alive) {
          setError(
            `${anon.error.message} Enable Anonymous sign-ins in Supabase → Authentication → Providers, or sign in another way.`,
          );
          setReady(true);
        }
        return;
      }
      if (alive) {
        setUser(anon.data.user ?? null);
        setReady(true);
      }
    })();
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user ?? null);
    });
    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  return { user, ready, error };
}

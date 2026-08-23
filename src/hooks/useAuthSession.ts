/**
 * useAuthSession Hook
 * Theo dõi trạng thái phiên đăng nhập (null = chưa đăng nhập)
 */

import { useEffect, useState } from 'react';

import { authStore, AuthSession } from '../services/authStore';

export function useAuthSession(): {
  ready: boolean;
  session: AuthSession | null;
} {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<AuthSession | null>(authStore.getSessionSync());

  useEffect(() => {
    let mounted = true;
    authStore.load().then(loaded => {
      if (mounted) {
        setSession(loaded);
        setReady(true);
      }
    });
    const unsubscribe = authStore.subscribe(next => {
      if (mounted) {
        setSession(next);
      }
    });
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  return { ready, session };
}

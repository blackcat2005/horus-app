import { Stack, useSegments, useRouter } from 'expo-router';
import { useEffect } from 'react';

import { useAuthSession } from '../src/hooks/useAuthSession';
import { logger } from '../src/utils/logger';

/**
 * Router guard: chưa đăng nhập -> /login; đã đăng nhập mà vẫn ở /login -> về tab chính
 */
function AuthGate({ children }: { children: React.ReactNode }) {
  const { ready, session } = useAuthSession();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (!ready) return;
    const inLogin = segments[0] === 'login';

    if (!session && !inLogin) {
      logger.info('AuthGate: redirect to login');
      router.replace('/login');
    } else if (session && inLogin) {
      logger.info('AuthGate: redirect to tabs');
      router.replace('/(tabs)');
    }
  }, [ready, session, segments, router]);

  return <>{children}</>;
}

export default function RootLayout() {
  return (
    <AuthGate>
      <Stack screenOptions={{ headerShown: false }} />
    </AuthGate>
  );
}

import { Tabs, useSegments, useRouter } from 'expo-router';
import { StyleSheet, Text } from 'react-native';
import { useEffect } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthSession } from '../../src/hooks/useAuthSession';
import { logger } from '../../src/utils/logger';
import { colors, radius, spacing } from '../../src/constants/theme';

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

function TabIcon({ label, focused }: { label: string; focused: boolean }) {
  return <Text style={[styles.icon, focused && styles.iconActive]}>{label}</Text>;
}

export default function TabLayout() {
  const insets = useSafeAreaInsets();
  return (
    <AuthGate>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: colors.primary,
          tabBarInactiveTintColor: colors.textMuted,
          tabBarStyle: [styles.tabBar, { height: 64 + insets.bottom, paddingBottom: insets.bottom + 4 }],
          tabBarLabelStyle: styles.tabLabel,
          tabBarItemStyle: styles.tabItem,
        }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Camera',
          tabBarIcon: ({ focused }) => <TabIcon label="📷" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="files"
        options={{
          title: 'Files',
          tabBarIcon: ({ focused }) => <TabIcon label="🗂️" focused={focused} />,
        }}
      />
      <Tabs.Screen name="controller" options={{ href: null }} />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Cài đặt',
          tabBarIcon: ({ focused }) => <TabIcon label="⚙️" focused={focused} />,
        }}
      />
      </Tabs>
    </AuthGate>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: colors.surface,
    borderTopColor: colors.border,
    height: 64,
    paddingTop: spacing.xs,
    paddingBottom: spacing.xs,
  },
  tabLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
  tabItem: {
    borderRadius: radius.md,
    marginVertical: 4,
  },
  icon: {
    fontSize: 20,
  },
  iconActive: {
    transform: [{ scale: 1.1 }],
  },
});

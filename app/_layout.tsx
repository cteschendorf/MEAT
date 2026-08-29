import { Tabs, type ErrorBoundaryProps, useRouter, useSegments } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, Text, View } from 'react-native';

import { openMeatDatabase, SqliteUserPreferencesRepository } from '@/data';

function AppScreenErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  return (
    <View style={{ flex: 1, justifyContent: 'center', padding: 24, gap: 12 }}>
      <Text selectable style={{ fontSize: 20, fontWeight: '600' }}>Something went wrong</Text>
      <Text selectable>{error.message}</Text>
      <Pressable accessibilityRole="button" onPress={retry}>
        <Text style={{ fontWeight: '600' }}>Try again</Text>
      </Pressable>
    </View>
  );
}

export const unstable_settings = { screenErrorBoundary: AppScreenErrorBoundary };

export default function RootLayout() {
  const router = useRouter();
  const segments = useSegments();
  const routeKey = segments.join('/');

  useEffect(() => {
    if (segments[0] === 'onboarding') return;
    let active = true;
    void openMeatDatabase()
      .then(async (db) => {
        const complete = await new SqliteUserPreferencesRepository(db).isOnboardingComplete();
        if (active && !complete) router.replace('/onboarding');
      })
      .catch(() => {
        // Individual screens own database error presentation; setup routing must not crash launch.
      });
    return () => {
      active = false;
    };
  }, [routeKey, router, segments]);

  return (
    <Tabs screenOptions={{ headerShadowVisible: false }}>
      <Tabs.Screen name="index" options={{ title: 'Today' }} />
      <Tabs.Screen name="journal" options={{ title: 'Journal' }} />
      <Tabs.Screen name="friends" options={{ title: 'Friends' }} />
      <Tabs.Screen name="me" options={{ title: 'Me' }} />
      <Tabs.Screen name="log-food" options={{ title: 'Log food', href: null }} />
      <Tabs.Screen name="manual-food" options={{ title: 'Manual food', href: null }} />
      <Tabs.Screen name="data-sources" options={{ title: 'Food data sources', href: null }} />
      <Tabs.Screen name="onboarding" options={{ title: 'Goals & units', href: null }} />
    </Tabs>
  );
}

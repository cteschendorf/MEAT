import { type ErrorBoundaryProps, useRouter, useSegments } from 'expo-router';
import Stack from 'expo-router/stack';
import { useEffect } from 'react';
import { Text, View } from 'react-native';

import { openMeatDatabase, SqliteUserPreferencesRepository } from '@/data';
import { ActionButton, spacing, typography, useThemeColors } from '@/ui';

function AppScreenErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  const colors = useThemeColors();

  return (
    <View
      style={{
        backgroundColor: colors.background,
        flex: 1,
        justifyContent: 'center',
        padding: spacing.lg,
        gap: spacing.md,
      }}
    >
      <Text accessibilityRole="header" allowFontScaling selectable style={[typography.title3, { color: colors.textPrimary }]}>Something went wrong</Text>
      <Text allowFontScaling selectable style={[typography.body, { color: colors.textSecondary }]}>{error.message}</Text>
      <ActionButton label="Try again" onPress={retry} />
    </View>
  );
}

export const unstable_settings = { anchor: '(tabs)', screenErrorBoundary: AppScreenErrorBoundary };

export default function RootLayout() {
  const colors = useThemeColors();
  const router = useRouter();
  const segments = useSegments();
  const isOnboardingRoute = segments.some((segment) => segment === 'onboarding');

  useEffect(() => {
    if (isOnboardingRoute) return;
    let active = true;
    void openMeatDatabase()
      .then(async (database) => {
        const complete = await new SqliteUserPreferencesRepository(database).isOnboardingComplete();
        if (active && !complete) router.replace('/onboarding');
      })
      .catch(() => {
        // Individual screens own database error presentation; setup routing must not crash launch.
      });
    return () => {
      active = false;
    };
  }, [isOnboardingRoute, router]);

  return (
    <Stack
      screenOptions={{
        contentStyle: { backgroundColor: colors.background },
        headerBackButtonDisplayMode: 'minimal',
        headerShadowVisible: false,
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.brand,
        headerTitleStyle: { color: colors.textPrimary, fontWeight: '700' },
      }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      {/* The composer is a sheet with its own chrome — a ✕, not a back
          chevron, and a chip row that already says where you are. A native
          "Log food" bar on top of that is two headers for one screen: it eats
          the safe-area inset ComposerHeader now claims for itself, and it's
          why the entry sheet reads as busier than the reference. */}
      <Stack.Screen name="log-food" options={{ headerShown: false }} />
      <Stack.Screen name="meals-recipes" options={{ title: 'Saved meals & recipes' }} />
      <Stack.Screen name="scan-barcode" options={{ title: 'Scan barcode' }} />
      <Stack.Screen name="manual-food" options={{ title: 'Manual food' }} />
      <Stack.Screen name="data-sources" options={{ title: 'Food data sources' }} />
      <Stack.Screen name="onboarding" options={{ title: 'Goals & units' }} />
      <Stack.Screen name="meal/[id]" options={{ title: 'Meal event' }} />
      <Stack.Screen
        name="meal-deleted"
        options={{ gestureEnabled: false, headerBackVisible: false, title: 'Meal deleted' }}
      />
    </Stack>
  );
}

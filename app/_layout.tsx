import { BarlowCondensed_400Regular } from '@expo-google-fonts/barlow-condensed/400Regular';
import { BarlowCondensed_500Medium } from '@expo-google-fonts/barlow-condensed/500Medium';
import { BarlowCondensed_600SemiBold } from '@expo-google-fonts/barlow-condensed/600SemiBold';
import { DMSans_300Light } from '@expo-google-fonts/dm-sans/300Light';
import { DMSans_400Regular } from '@expo-google-fonts/dm-sans/400Regular';
import { DMSans_500Medium } from '@expo-google-fonts/dm-sans/500Medium';
import { DMSans_600SemiBold } from '@expo-google-fonts/dm-sans/600SemiBold';
import { useFonts } from 'expo-font';
import { type ErrorBoundaryProps, useRouter, useSegments } from 'expo-router';
import Stack from 'expo-router/stack';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { Text, View } from 'react-native';

import { openMeatDatabase, SqliteUserPreferencesRepository } from '@/data';
import { ActionButton, fontFamilies, spacing, typography, useThemeColors } from '@/ui';

void SplashScreen.preventAutoHideAsync();

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
  const [fontsLoaded, fontError] = useFonts({
    BarlowCondensed_400Regular,
    BarlowCondensed_500Medium,
    BarlowCondensed_600SemiBold,
    DMSans_300Light,
    DMSans_400Regular,
    DMSans_500Medium,
    DMSans_600SemiBold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) void SplashScreen.hideAsync();
  }, [fontError, fontsLoaded]);

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

  if (!fontsLoaded && !fontError) return null;

  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          contentStyle: { backgroundColor: colors.background },
          headerBackButtonDisplayMode: 'minimal',
          headerShadowVisible: false,
          headerStyle: { backgroundColor: colors.chrome },
          headerTintColor: colors.brand,
          headerTitleStyle: {
            color: colors.textOnChrome,
            fontFamily: fontFamilies.displayMedium,
            fontSize: 22,
          },
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
    </>
  );
}

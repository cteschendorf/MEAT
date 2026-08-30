import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';

import {
  buildMealTimelineEntries,
  openAppServices,
  pageFromLookahead,
  type MealTimelineEntry,
} from '@/services';
import { LatestRequestGate } from '@/services/actions/exclusive-action';
import {
  ActionButton,
  MealTimeline,
  ScreenState,
  Surface,
  spacing,
  typography,
  useThemeColors,
} from '@/ui';
import { JOURNAL_PAGE_SIZE, nextJournalLimit } from '@/ui/journal-pagination';

type LoadMode = 'initial' | 'refresh' | 'more';

export function JournalScreen() {
  const colors = useThemeColors();
  const router = useRouter();
  const [entries, setEntries] = useState<readonly MealTimelineEntry[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadMode, setLoadMode] = useState<LoadMode | null>('initial');
  const [error, setError] = useState<string | null>(null);
  const visibleLimit = useRef(JOURNAL_PAGE_SIZE);
  const hasLoaded = useRef(false);
  const requestGate = useRef(new LatestRequestGate()).current;

  const load = useCallback(async (mode: LoadMode, requestedLimit: number) => {
    const requestGeneration = requestGate.begin();
    setLoadMode(mode);
    try {
      const services = await openAppServices();
      const recentMeals = await services.mealHistory.listRecent(requestedLimit + 1);
      const page = pageFromLookahead(recentMeals, requestedLimit);
      const nextEntries = await buildMealTimelineEntries(page.values, services.foods, {
        media: services.media,
      });
      if (!requestGate.isCurrent(requestGeneration)) return;
      visibleLimit.current = requestedLimit;
      hasLoaded.current = true;
      setEntries(nextEntries);
      setHasMore(page.hasMore);
      setError(null);
      setLoadMode(null);
    } catch (caught) {
      if (!requestGate.isCurrent(requestGeneration)) return;
      hasLoaded.current = true;
      setError(caught instanceof Error ? caught.message : 'Unable to load meal history.');
      setLoadMode(null);
    }
  }, [requestGate]);

  useFocusEffect(
    useCallback(() => {
      void load(hasLoaded.current ? 'refresh' : 'initial', visibleLimit.current);
      return () => requestGate.invalidate();
    }, [load, requestGate]),
  );

  const refreshing = loadMode === 'refresh';
  const loadingMore = loadMode === 'more';

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{
        backgroundColor: colors.background,
        gap: spacing.lg,
        padding: spacing.md,
        paddingBottom: spacing.xxl,
      }}
      refreshControl={(
        <RefreshControl
          refreshing={refreshing}
          tintColor={colors.action}
          onRefresh={() => void load('refresh', visibleLimit.current)}
        />
      )}
      style={{ backgroundColor: colors.background }}
    >
      <View style={{ gap: spacing.xs }}>
        <Text accessibilityRole="header" allowFontScaling selectable style={[typography.largeTitle, { color: colors.textPrimary }]}>Journal</Text>
        <Text allowFontScaling selectable style={[typography.body, { color: colors.textSecondary }]}>Your complete meal history, grouped by day.</Text>
      </View>

      {loadMode === 'initial' && entries.length === 0 ? (
        <ScreenState title="Loading journal" message="Gathering your meal history…" />
      ) : null}

      {error ? (
        <Surface>
          <ScreenState title="Journal unavailable" message={error} role="alert" />
          <ActionButton
            label="Try again"
            onPress={() => void load('refresh', visibleLimit.current)}
            style={{ marginHorizontal: spacing.lg, marginBottom: spacing.lg }}
            tone="secondary"
          />
        </Surface>
      ) : null}

      {!error && loadMode !== 'initial' && entries.length === 0 ? (
        <Surface>
          <ScreenState
            title="Your journal is ready"
            message="Meals you log will appear here with their foods, time, and any saved place or photo."
          />
        </Surface>
      ) : null}

      {entries.length > 0 ? (
        <MealTimeline
          entries={entries}
          onPressEntry={(entry) => router.push({ pathname: '/meal/[id]', params: { id: entry.id } })}
        />
      ) : null}

      {entries.length > 0 && !error ? (
        hasMore ? (
          <ActionButton
            disabled={loadingMore}
            label={loadingMore ? 'Loading older meals…' : 'Load older meals'}
            onPress={() => void load('more', nextJournalLimit(visibleLimit.current))}
            tone="secondary"
          />
        ) : (
          <Text
            accessibilityLiveRegion="polite"
            allowFontScaling
            selectable
            style={[typography.caption, { color: colors.textSecondary, textAlign: 'center' }]}
          >
            You’re all caught up.
          </Text>
        )
      ) : null}
    </ScrollView>
  );
}

export default JournalScreen;

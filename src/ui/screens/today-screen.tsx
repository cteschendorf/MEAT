import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import type { ISODateTime } from '@/domain/shared/ids';
import {
  buildMealTimelineEntries,
  buildTodaySnapshot,
  openAppServices,
  type MealTimelineEntry,
  type TodaySnapshot,
} from '@/services';
import { LatestRequestGate } from '@/services/actions/exclusive-action';
import {
  ActionButton,
  MealTimeline,
  NutritionDashboard,
  ScreenState,
  Surface,
  minimumTouchTarget,
  spacing,
  typography,
  useThemeColors,
} from '@/ui';

function calendarDayLabel(date: Date, isToday: boolean): string {
  if (isToday) return date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  return date.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function TodayScreen() {
  const colors = useThemeColors();
  const router = useRouter();
  const [date, setDate] = useState(() => new Date());
  const [snapshot, setSnapshot] = useState<TodaySnapshot | null>(null);
  const [timelineEntries, setTimelineEntries] = useState<readonly MealTimelineEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const requestGate = useRef(new LatestRequestGate()).current;

  const load = useCallback(async () => {
    const requestGeneration = requestGate.begin();
    const requestedDate = new Date(date);
    try {
      const services = await openAppServices();
      const nextSnapshot = await buildTodaySnapshot(requestedDate, {
        meals: services.meals,
        foods: services.foods,
        goals: services.goals,
      });
      const nextTimelineEntries = await buildMealTimelineEntries(nextSnapshot.meals, services.foods, {
        media: services.media,
      });
      if (!requestGate.isCurrent(requestGeneration)) return;
      setSnapshot(nextSnapshot);
      setTimelineEntries(nextTimelineEntries);
      setError(null);
    } catch (caught) {
      if (!requestGate.isCurrent(requestGeneration)) return;
      setSnapshot(null);
      setTimelineEntries([]);
      setError(caught instanceof Error ? caught.message : 'Unable to load Today.');
    }
  }, [date, requestGate]);

  useFocusEffect(
    useCallback(() => {
      void load();
      return () => requestGate.invalidate();
    }, [load, requestGate]),
  );

  function moveDay(days: number) {
    requestGate.invalidate();
    setSnapshot(null);
    setTimelineEntries([]);
    setError(null);
    setDate((current) => {
      const next = new Date(current);
      next.setDate(next.getDate() + days);
      return next;
    });
  }

  function returnToToday() {
    requestGate.invalidate();
    setSnapshot(null);
    setTimelineEntries([]);
    setError(null);
    setDate(new Date());
  }

  function retryLoad() {
    requestGate.invalidate();
    setSnapshot(null);
    setTimelineEntries([]);
    setError(null);
    void load();
  }

  function openComposerForSelectedDay() {
    const now = new Date();
    const occurredAt = new Date(date);
    occurredAt.setHours(now.getHours(), now.getMinutes(), now.getSeconds(), now.getMilliseconds());
    router.push({
      pathname: '/log-food',
      params: { occurredAt: occurredAt.toISOString() as ISODateTime },
    });
  }

  const isToday = new Date().toDateString() === date.toDateString();
  const dateLabel = calendarDayLabel(date, isToday);

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{
        backgroundColor: colors.background,
        gap: spacing.lg,
        padding: spacing.md,
        paddingBottom: spacing.xxl,
      }}
      style={{ backgroundColor: colors.background }}
    >
      <View style={{ gap: spacing.xs }}>
        <View style={{ alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' }}>
          <Pressable
            accessibilityLabel="Previous day"
            accessibilityRole="button"
            hitSlop={8}
            onPress={() => moveDay(-1)}
            style={({ pressed }) => ({
              alignItems: 'center',
              justifyContent: 'center',
              minHeight: minimumTouchTarget,
              minWidth: minimumTouchTarget,
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <Text allowFontScaling style={[typography.title1, { color: colors.action }]}>‹</Text>
          </Pressable>

          <View style={{ alignItems: 'center', flex: 1, gap: spacing.xxs }}>
            <Text accessibilityRole="header" allowFontScaling selectable style={[typography.largeTitle, { color: colors.textPrimary }]}>Today</Text>
            <Text allowFontScaling selectable style={[typography.caption, { color: colors.textSecondary }]}>
              {dateLabel}
            </Text>
          </View>

          <Pressable
            accessibilityLabel="Next day"
            accessibilityRole="button"
            accessibilityState={{ disabled: isToday }}
            disabled={isToday}
            hitSlop={8}
            onPress={() => moveDay(1)}
            style={({ pressed }) => ({
              alignItems: 'center',
              justifyContent: 'center',
              minHeight: minimumTouchTarget,
              minWidth: minimumTouchTarget,
              opacity: isToday ? 0.25 : pressed ? 0.6 : 1,
            })}
          >
            <Text allowFontScaling style={[typography.title1, { color: colors.action }]}>›</Text>
          </Pressable>
        </View>

        {isToday ? (
          <ActionButton label="Log food" onPress={() => router.push('/log-food')} />
        ) : (
          <View style={{ gap: spacing.xs }}>
            <ActionButton label="Log food for this day" onPress={openComposerForSelectedDay} />
            <ActionButton label="Return to today" onPress={returnToToday} tone="secondary" />
          </View>
        )}
      </View>

      {error ? (
        <Surface>
          <ScreenState title="Today unavailable" message={error} role="alert" />
          <ActionButton
            label="Try again"
            onPress={retryLoad}
            style={{ marginHorizontal: spacing.lg, marginBottom: spacing.lg }}
            tone="secondary"
          />
        </Surface>
      ) : null}
      {!snapshot && !error ? <ScreenState title="Loading" message="Calculating nutrition and meal history…" /> : null}

      {snapshot ? (
        <>
          {snapshot.unavailableItems.length > 0 ? (
            <Surface>
              <ScreenState
                title="Some nutrition is unavailable"
                message={`${snapshot.unavailableItems.length} logged ${snapshot.unavailableItems.length === 1 ? 'item could' : 'items could'} not be read from saved provider data. Your timeline is intact, but totals are hidden so MEAT does not show a misleading subtotal.`}
                role="alert"
              />
            </Surface>
          ) : null}

          <NutritionDashboard metrics={snapshot.metrics} />

          <View style={{ gap: spacing.md }}>
            <View style={{ gap: spacing.xxs }}>
              <Text accessibilityRole="header" allowFontScaling selectable style={[typography.title2, { color: colors.textPrimary }]}>Timeline</Text>
              <Text allowFontScaling selectable style={[typography.body, { color: colors.textSecondary }]}>Your meals, in the order they happened.</Text>
            </View>

            {timelineEntries.length === 0 ? (
              <Surface>
                <ScreenState
                  title="Nothing logged yet"
                  message="Log your first food when you eat—MEAT does not require a perfectly complete diary."
                />
              </Surface>
            ) : (
              <MealTimeline
                entries={timelineEntries}
                onPressEntry={(entry) => router.push({ pathname: '/meal/[id]', params: { id: entry.id } })}
                showDayHeadings={false}
              />
            )}
          </View>
        </>
      ) : null}
    </ScrollView>
  );
}

export default TodayScreen;

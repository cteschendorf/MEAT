import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import {
  buildTodaySnapshot,
  openAppServices,
  type TodayMetric,
  type TodaySnapshot,
} from '@/services';
import { LatestRequestGate } from '@/services/actions/exclusive-action';
import { ActionButton, ScreenState, Surface, spacing, typography, useThemeColors } from '@/ui';

const metricLabels: Record<TodayMetric['code'], string> = {
  'energy-kcal': 'Calories',
  'protein-g': 'Protein',
  'carbohydrate-g': 'Carbs',
  'fat-g': 'Fat',
  'fiber-g': 'Fiber',
};

function metricValue(metric: TodayMetric) {
  if (metric.value === null) return '—';
  const rounded = metric.code === 'energy-kcal' ? Math.round(metric.value) : Math.round(metric.value * 10) / 10;
  return metric.code === 'energy-kcal' ? `${rounded}` : `${rounded} g`;
}

function goalText(metric: TodayMetric) {
  const goal = metric.goal;
  if (!goal) return metric.state === 'unknown' ? 'No data yet' : 'No active goal';
  switch (goal.status) {
    case 'met':
      return 'Minimum met';
    case 'below':
      return `${Math.round((goal.remaining ?? 0) * 10) / 10} remaining`;
    case 'within':
      return goal.remaining === null ? 'Within target' : `${Math.round(goal.remaining * 10) / 10} remaining`;
    case 'exceeded':
      return 'Above target';
    default:
      return 'Tracking only';
  }
}

export default function TodayScreen() {
  const colors = useThemeColors();
  const router = useRouter();
  const [date, setDate] = useState(() => new Date());
  const [snapshot, setSnapshot] = useState<TodaySnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestGate = useRef(new LatestRequestGate()).current;

  const load = useCallback(async () => {
    const requestGeneration = requestGate.begin();
    const requestedDate = new Date(date);
    try {
      const services = await openAppServices();
      const next = await buildTodaySnapshot(requestedDate, {
        meals: services.meals,
        foods: services.foods,
        goals: services.goals,
      });
      if (!requestGate.isCurrent(requestGeneration)) return;
      setSnapshot(next);
      setError(null);
    } catch (caught) {
      if (!requestGate.isCurrent(requestGeneration)) return;
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
    setError(null);
    setDate((current) => {
      const next = new Date(current);
      next.setDate(next.getDate() + days);
      return next;
    });
  }

  const isToday = new Date().toDateString() === date.toDateString();

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ padding: spacing.md, gap: spacing.md, backgroundColor: colors.background }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Previous day" onPress={() => moveDay(-1)}>
          <Text allowFontScaling style={[typography.title2, { color: colors.action }]}>‹</Text>
        </Pressable>
        <View style={{ alignItems: 'center' }}>
          <Text allowFontScaling selectable style={[typography.title1, { color: colors.textPrimary }]}>Today</Text>
          <Text allowFontScaling selectable style={[typography.caption, { color: colors.textSecondary }]}>
            {isToday ? 'Today' : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Next day"
          disabled={isToday}
          onPress={() => moveDay(1)}
          style={{ opacity: isToday ? 0.3 : 1 }}
        >
          <Text allowFontScaling style={[typography.title2, { color: colors.action }]}>›</Text>
        </Pressable>
      </View>

      <ActionButton label="Log food" onPress={() => router.push('/log-food')} />

      {error ? <ScreenState title="Today unavailable" message={error} role="alert" /> : null}
      {!snapshot && !error ? <ScreenState title="Loading" message="Calculating today’s nutrition…" /> : null}

      {snapshot ? (
        <>
          {snapshot.unavailableItems.length ? (
            <ScreenState
              title="Some logged foods are unavailable"
              message={`${snapshot.unavailableItems.length} logged ${snapshot.unavailableItems.length === 1 ? 'item could' : 'items could'} not be read from saved provider data. Your meal history is preserved, but totals are hidden so MEAT does not show a misleading subtotal.`}
              role="alert"
            />
          ) : null}
          <View style={{ gap: spacing.sm }}>
            {snapshot.metrics.map((metric) => (
              <Surface key={metric.code}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md }}>
                  <View style={{ flex: 1 }}>
                    <Text allowFontScaling selectable style={[typography.bodyStrong, { color: colors.textPrimary }]}>{metricLabels[metric.code]}</Text>
                    <Text allowFontScaling selectable style={[typography.caption, { color: colors.textSecondary }]}>{goalText(metric)}</Text>
                  </View>
                  <Text allowFontScaling selectable style={[typography.title3, { color: colors.textPrimary }]}>{metricValue(metric)}</Text>
                </View>
              </Surface>
            ))}
          </View>

          <Text allowFontScaling selectable style={[typography.title2, { color: colors.textPrimary }]}>Meals</Text>
          {snapshot.meals.length === 0 ? (
            <Surface>
              <Text allowFontScaling selectable style={[typography.body, { color: colors.textSecondary }]}>Nothing logged yet. Log your first food when you eat—MEAT does not require a perfectly complete diary.</Text>
            </Surface>
          ) : (
            snapshot.meals.map((meal) => (
              <Surface key={meal.id}>
                <Text allowFontScaling selectable style={[typography.bodyStrong, { color: colors.textPrimary }]}>
                  {new Date(meal.occurredAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                </Text>
                <Text allowFontScaling selectable style={[typography.caption, { color: colors.textSecondary }]}>
                  {meal.items.length} {meal.items.length === 1 ? 'item' : 'items'}
                </Text>
              </Surface>
            ))
          )}
        </>
      ) : null}
    </ScrollView>
  );
}

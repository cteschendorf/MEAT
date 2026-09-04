import { createElement } from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import type { MealTimelineEntry } from '../src/services/meals/meal-timeline-presentation';
import type { TodayMetric } from '../src/services/today/snapshot';
import type { GoalId, ISODateTime } from '../src/domain/shared/ids';
import { MealTimeline } from '../src/ui/components/meal-timeline';
import { NutritionDashboard } from '../src/ui/components/nutrition-dashboard';
import { ScreenState } from '../src/ui/components/screen-state';

const metrics: readonly TodayMetric[] = [
  { code: 'energy-kcal', value: 1_850, state: 'known', goal: null },
  { code: 'protein-g', value: 126, state: 'known', goal: null },
  { code: 'carbohydrate-g', value: 210, state: 'known', goal: null },
  { code: 'fat-g', value: 62, state: 'known', goal: null },
  { code: 'fiber-g', value: 28, state: 'known', goal: null },
];

function timelineEntry(id: string, hour: number, title?: string): MealTimelineEntry {
  const occurredAt = new Date(2026, 7, 29, hour, 0).toISOString();
  return {
    id,
    occurredAt,
    createdAt: occurredAt,
    dayKey: '2026-08-29',
    foodSummary: id === 'meal:breakfast' ? 'Eggs & toast' : 'Chicken breast',
    ...(title ? { mealTitle: title } : {}),
    locationLabel: 'Home',
    items: [{ id: `${id}:item`, name: 'Food', portionText: '100 g' }],
  };
}

describe('branded nutrition dashboard', () => {
  it('renders the compound energy and macro hierarchy with accessible metric values', async () => {
    const dashboard = await render(createElement(NutritionDashboard, { metrics }));

    expect(dashboard.getByLabelText('Daily nutrition')).toBeTruthy();
    expect(dashboard.getByLabelText('Protein, 126 g. No goal set')).toBeTruthy();
    expect(dashboard.getByLabelText('Calories, 1850 kcal. No goal set')).toBeTruthy();
    expect(dashboard.getByLabelText('Carbs, 210 g. No goal set')).toBeTruthy();
    expect(dashboard.getByLabelText('Fat, 62 g. No goal set')).toBeTruthy();
    expect(dashboard.getByLabelText('Fiber, 28 g. No goal set')).toBeTruthy();
    expect(dashboard.getByText('Energy · today')).toBeTruthy();
    // Protein leads the hero and is not repeated in the compact strip below —
    // unlike the old parchment layout, this concept has no macro-strip
    // duplicate of it to hide from accessibility, hidden or otherwise.
    expect(dashboard.getAllByText(/protein/i, { includeHiddenElements: true })).toHaveLength(1);
    expect(dashboard.getByText('Fiber')).toBeTruthy();
    expect(dashboard.getByText('Carbs')).toBeTruthy();
    expect(dashboard.getByText('Fat')).toBeTruthy();
    expect(dashboard.queryAllByRole('progressbar')).toHaveLength(0);
  });

  it('announces active energy progress and keeps goal context on each metric', async () => {
    const activeMetrics = metrics.map((metric): TodayMetric => {
      if (metric.code !== 'protein-g' && metric.code !== 'energy-kcal') return metric;
      const target = metric.code === 'protein-g' ? 160 : 2_200;
      return {
        ...metric,
        goal: {
          goal: {
            id: `goal:${metric.code}` as GoalId,
            nutrientCode: metric.code,
            target: { mode: 'minimum', minimum: target },
            effectiveFrom: '2026-08-29T00:00:00.000Z' as ISODateTime,
          },
          current: metric.value ?? 0,
          status: 'below',
          ratio: (metric.value ?? 0) / target,
          remaining: target - (metric.value ?? 0),
        },
      };
    });
    const dashboard = await render(createElement(NutritionDashboard, { metrics: activeMetrics }));

    expect(dashboard.getByLabelText('Protein, 126 g. 34 g to goal')).toBeTruthy();
    expect(dashboard.getByLabelText('Calories, 1850 kcal. 350 kcal to goal')).toBeTruthy();

    const energyProgress = dashboard.getByRole('progressbar', { name: 'Calorie goal progress' });
    expect(energyProgress.props.accessibilityValue).toEqual({
      min: 0,
      max: 100,
      now: 84,
      text: '84 percent',
    });
    expect(dashboard.queryByLabelText('Protein goal progress')).toBeNull();
  });
});

describe('meal timeline', () => {
  it('renders food summaries first and an optional meal title as secondary context', async () => {
    const entries = [
      timelineEntry('meal:lunch', 12, 'Post-workout lunch'),
      timelineEntry('meal:breakfast', 8),
    ];
    const timeline = await render(createElement(MealTimeline, { entries, showDayHeadings: false }));

    expect(timeline.getByText('Eggs & toast')).toBeTruthy();
    expect(timeline.getByText('Chicken breast')).toBeTruthy();
    expect(timeline.getByText('Post-workout lunch')).toBeTruthy();
    expect(timeline.getAllByText('At Home')).toHaveLength(2);
    expect(timeline.getByLabelText(/Eggs & toast/)).toBeTruthy();
  });

  it('opens the selected event without changing timeline ordering', async () => {
    const onPressEntry = jest.fn();
    const entries = [
      timelineEntry('meal:lunch', 12, 'Post-workout lunch'),
      timelineEntry('meal:breakfast', 8),
    ];
    const timeline = await render(createElement(MealTimeline, {
      entries,
      onPressEntry,
      showDayHeadings: false,
    }));

    fireEvent.press(timeline.getByRole('button', { name: /Eggs & toast/ }));

    expect(onPressEntry).toHaveBeenCalledTimes(1);
    expect(onPressEntry).toHaveBeenCalledWith(expect.objectContaining({ id: 'meal:breakfast' }));
  });
});

describe('announced screen states', () => {
  it('exposes retryable errors with alert semantics', async () => {
    const state = await render(createElement(ScreenState, {
      title: 'Source unavailable',
      message: 'Try again.',
      role: 'alert',
    }));

    expect(state.getByRole('alert')).toBeTruthy();
  });
});

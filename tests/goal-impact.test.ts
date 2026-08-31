import assert from 'node:assert/strict';
import test from 'node:test';

import { goalImpact, goalImpactAccessibilityLabel } from '../src/ui/goal-impact';
import type { TodayMetric } from '../src/services/today/snapshot';
import type { GoalId, ISODateTime } from '../src/domain/shared/ids';
import { metricGoalImpact, metricGoalText, metricProgress } from '../src/ui/nutrition-dashboard-model';

test('a minimum reads as progress toward a floor, and clearing it is success', () => {
  const below = goalImpact({
    code: 'protein-g',
    current: 96,
    pending: 31,
    target: { mode: 'minimum', minimum: 180 },
  });
  assert.equal(below.shape, 'progress');
  assert.equal(below.tone, 'neutral');
  assert.equal(below.summary, '127 of 180 g minimum');
  assert.equal(below.delta, '+31 g');
  assert.ok(Math.abs(below.currentFraction - 96 / 180) < 1e-9);
  // The pending share sits on top of the current one rather than replacing it.
  assert.ok(Math.abs(below.currentFraction + below.pendingFraction - 127 / 180) < 1e-9);
  assert.equal(below.overBy, null);

  const cleared = goalImpact({
    code: 'protein-g',
    current: 175,
    pending: 31,
    target: { mode: 'minimum', minimum: 180 },
  });
  assert.equal(cleared.tone, 'good');
  // Past a floor the bar saturates; there is no such thing as over-clearing it.
  assert.equal(cleared.currentFraction + cleared.pendingFraction, 1);
  assert.equal(cleared.overBy, null);
});

test('a maximum reads as consumption against a cap, and passing it is not success', () => {
  const comfortable = goalImpact({
    code: 'energy-kcal',
    current: 810,
    pending: 165,
    target: { mode: 'maximum', maximum: 1840 },
  });
  assert.equal(comfortable.shape, 'cap');
  assert.equal(comfortable.tone, 'good');
  assert.equal(comfortable.summary, '975 of 1840 kcal limit');

  const close = goalImpact({
    code: 'energy-kcal',
    current: 1500,
    pending: 165,
    target: { mode: 'maximum', maximum: 1840 },
  });
  assert.equal(close.tone, 'caution');

  const over = goalImpact({
    code: 'energy-kcal',
    current: 1800,
    pending: 165,
    target: { mode: 'maximum', maximum: 1840 },
  });
  assert.equal(over.tone, 'over');
  // A full bar has to say how far past, or it looks identical to landing exactly
  // on the cap — which is the one reading a cap must never give.
  assert.equal(over.overBy, 125);
});

test('a full protein bar and a full calorie bar mean opposite things', () => {
  // This is the whole reason four identical rings were wrong.
  const protein = goalImpact({ code: 'protein-g', current: 200, target: { mode: 'minimum', minimum: 180 } });
  const calories = goalImpact({ code: 'energy-kcal', current: 2000, target: { mode: 'maximum', maximum: 1840 } });
  assert.equal(protein.currentFraction, 1);
  assert.equal(calories.currentFraction, 1);
  assert.equal(protein.tone, 'good');
  assert.equal(calories.tone, 'over');
});

test('a range marks the zone to land in rather than a single number to fill', () => {
  const inside = goalImpact({
    code: 'carbohydrate-g',
    current: 120,
    pending: 35,
    target: { mode: 'range', minimum: 140, maximum: 200 },
  });
  assert.equal(inside.shape, 'band');
  assert.equal(inside.tone, 'good');
  assert.deepEqual(inside.band, { start: 140 / 200, end: 1 });
  assert.equal(inside.summary, '155 of 140–200 g');

  const short = goalImpact({
    code: 'carbohydrate-g',
    current: 40,
    target: { mode: 'range', minimum: 140, maximum: 200 },
  });
  assert.equal(short.tone, 'neutral');

  // Above the ceiling the track has to grow, or overshooting is indistinguishable
  // from landing exactly on it.
  const above = goalImpact({
    code: 'carbohydrate-g',
    current: 260,
    target: { mode: 'range', minimum: 140, maximum: 200 },
  });
  assert.equal(above.tone, 'over');
  assert.equal(above.overBy, 60);
  assert.ok(above.band !== null && above.band.end < 1);
});

test('no target renders as no target, never as zero percent', () => {
  // Every goal defaults to mode "none", so this is what a user who skipped goal
  // setup sees on every row. An empty bar would claim a goal they never set.
  for (const target of [null, { mode: 'none' } as const]) {
    const impact = goalImpact({ code: 'fiber-g', current: 12, pending: 3, target });
    assert.equal(impact.shape, 'untargeted');
    assert.equal(impact.summary, 'No target set');
    assert.equal(impact.currentFraction, 0);
    assert.equal(impact.pendingFraction, 0);
    // The contribution is still worth showing even with nothing to measure against.
    assert.equal(impact.delta, '+3 g');
  }
});

test('degenerate targets fall back rather than dividing', () => {
  // evaluateGoal returns an infinite ratio for a zero maximum; nothing may hand
  // that to a layout.
  assert.equal(
    goalImpact({ code: 'energy-kcal', current: 500, target: { mode: 'maximum', maximum: 0 } }).shape,
    'untargeted',
  );
  // A floor of zero is cleared by definition, so there is no progress to draw.
  assert.equal(
    goalImpact({ code: 'protein-g', current: 30, target: { mode: 'minimum', minimum: 0 } }).shape,
    'untargeted',
  );
  // An inverted range is corrupt input, not a band.
  assert.equal(
    goalImpact({
      code: 'carbohydrate-g',
      current: 30,
      target: { mode: 'range', minimum: 200, maximum: 140 },
    }).shape,
    'untargeted',
  );
});

test('an unknown contribution stays unknown instead of counting as zero', () => {
  // Branded records routinely omit fibre. Such a food does not add no fibre; it
  // adds an amount nobody knows, and the row has to say so.
  const impact = goalImpact({
    code: 'fiber-g',
    current: 12,
    pending: null,
    target: { mode: 'minimum', minimum: 30 },
  });
  assert.equal(impact.delta, '+? g');
  assert.equal(impact.pendingFraction, 0);
  assert.ok(Math.abs(impact.currentFraction - 12 / 30) < 1e-9);

  // Not passing a pending value at all is a different question, and gets no delta.
  const standing = goalImpact({ code: 'fiber-g', current: 12, target: { mode: 'minimum', minimum: 30 } });
  assert.equal(standing.delta, null);
});

test('a day that could not be totalled says so rather than showing an empty bar', () => {
  const impact = goalImpact({
    code: 'protein-g',
    current: null,
    target: { mode: 'minimum', minimum: 180 },
  });
  assert.equal(impact.shape, 'untargeted');
  assert.equal(impact.summary, 'No data yet');
});

test('each row reads as a sentence for screen readers', () => {
  assert.equal(
    goalImpactAccessibilityLabel(
      goalImpact({ code: 'protein-g', current: 96, pending: 31, target: { mode: 'minimum', minimum: 180 } }),
    ),
    'Protein, 127 of 180 g minimum, this food adds 31 g.',
  );
  assert.equal(
    goalImpactAccessibilityLabel(
      goalImpact({ code: 'energy-kcal', current: 1800, pending: 165, target: { mode: 'maximum', maximum: 1840 } }),
    ),
    'Calories, 1965 of 1840 kcal limit, this food adds 165 kcal, over by 125 kcal.',
  );
});

function dashboardMetric(
  code: TodayMetric['code'],
  value: number | null,
  target: { mode: 'minimum' | 'maximum' | 'none'; minimum?: number; maximum?: number } | null,
  status: 'below' | 'met' | 'within' | 'exceeded' | 'informational' = 'below',
): TodayMetric {
  return {
    code,
    value,
    state: value === null ? 'unknown' : 'known',
    goal: target
      ? {
          goal: {
            id: `goal:${code}` as GoalId,
            nutrientCode: code,
            target,
            effectiveFrom: '2026-08-31T00:00:00.000Z' as ISODateTime,
          },
          current: value ?? 0,
          status,
          ratio: null,
          remaining: null,
        }
      : null,
  };
}

test('the dashboard reads targets through the same rules as the detail sheet', () => {
  // Both surfaces consume one module, so a filled protein bar and a filled
  // calorie arc cannot drift into meaning the same thing on one screen and
  // opposite things on the other (THI-333).
  const protein = dashboardMetric('protein-g', 200, { mode: 'minimum', minimum: 180 }, 'met');
  const calories = dashboardMetric('energy-kcal', 2000, { mode: 'maximum', maximum: 1840 }, 'exceeded');

  assert.equal(metricProgress(protein), 1);
  assert.equal(metricProgress(calories), 1);
  assert.equal(metricGoalImpact(protein).tone, 'good');
  assert.equal(metricGoalImpact(calories).tone, 'over');

  // A passed cap says by how much: "Above target" alone reads the same whether
  // you are 5 kcal over or 500.
  assert.equal(metricGoalText(calories), 'Above target by 160 kcal');
});

test('the dashboard no longer draws a full bar for a target it cannot divide by', () => {
  // A zero cap makes the engine's ratio infinite. The dashboard used to clamp
  // that to 1 and render a completed arc for a goal that cannot be evaluated.
  assert.equal(metricProgress(dashboardMetric('energy-kcal', 500, { mode: 'maximum', maximum: 0 })), null);
  // No target at all stays no target, rather than an empty bar claiming zero
  // percent of a goal the user never set.
  assert.equal(metricProgress(dashboardMetric('fiber-g', 12, null)), null);
  assert.equal(metricProgress(dashboardMetric('fiber-g', 12, { mode: 'none' })), null);
});

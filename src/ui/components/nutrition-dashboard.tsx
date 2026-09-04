import { Text, useWindowDimensions, View } from 'react-native';

import type { TodayMetric, TodayMetricCode } from '@/services/today/snapshot';
import {
  dashboardMetricLabels,
  metricAccessibilityLabel,
  metricForCode,
  metricGoalImpact,
  metricGoalText,
  metricProgress,
  metricUnit,
  metricValueText,
} from '@/ui/nutrition-dashboard-model';
import { radii, spacing, typography } from '@/ui/theme/tokens';
import { useThemeColors } from '@/ui/theme/use-theme';

function MetricValue({
  metric,
  color,
  unitColor,
  hero = false,
}: {
  readonly metric: TodayMetric;
  readonly color: string;
  readonly unitColor: string;
  readonly hero?: boolean;
}) {
  const valueStyle = hero ? typography.metricHero : typography.metricCompact;

  return (
    <View style={{ alignItems: 'baseline', flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xxs }}>
      <Text allowFontScaling selectable style={[valueStyle, { color }]}>
        {metricValueText(metric)}
      </Text>
      <Text
        allowFontScaling
        selectable
        style={[typography.caption, { color: unitColor }]}
      >
        {metricUnit(metric)}
      </Text>
    </View>
  );
}

/**
 * Calories and protein, in one dark card rather than a light panel.
 *
 * The earlier "Version 4" system gave this its own parchment-toned surface —
 * a deliberate light moment inside an otherwise dark app. This concept has no
 * such moment anywhere: one gold accent, one dark ladder of surfaces, and the
 * hero card is simply the lightest step in that ladder (`surfaceElevated`),
 * the same way the Figma concept's own hero nutrition card is just `T.card`
 * on `T.bg`, not a light panel.
 */
function EnergyHero({ calories, protein }: { readonly calories: TodayMetric; readonly protein: TodayMetric }) {
  const colors = useThemeColors();
  const { fontScale, width } = useWindowDimensions();
  const progress = metricProgress(calories);
  const percentage = progress === null ? null : Math.round(progress * 100);
  const over = metricGoalImpact(calories).tone === 'over';
  const stackMetrics = fontScale >= 1.35 || width < 360;

  return (
    <View
      style={{
        gap: spacing.md,
        paddingHorizontal: 20,
        paddingVertical: 18,
      }}
    >
      <Text allowFontScaling selectable style={[typography.overline, { color: colors.textSecondary }]}>
        Energy · today
      </Text>

      <View
        style={{
          alignItems: stackMetrics ? 'stretch' : 'flex-end',
          flexDirection: stackMetrics ? 'column' : 'row',
          gap: spacing.md,
          justifyContent: 'space-between',
        }}
      >
        <View
          accessible
          accessibilityLabel={metricAccessibilityLabel(calories)}
          style={{ flex: 1, gap: spacing.xxs }}
        >
          <MetricValue
            color={colors.textPrimary}
            hero
            metric={calories}
            unitColor={colors.textSecondary}
          />
          <Text
            allowFontScaling
            selectable
            style={[typography.caption, { color: colors.textSecondary }]}
          >
            {metricGoalText(calories)}
          </Text>
        </View>

        {/* Protein is the one metric that gets the accent — it leads because
            this is a protein-first tracker, not a calorie-first one. */}
        <View
          accessible
          accessibilityLabel={metricAccessibilityLabel(protein)}
          style={{ alignItems: stackMetrics ? 'flex-start' : 'flex-end', flexShrink: 0, gap: spacing.xxs }}
        >
          <Text allowFontScaling selectable style={[typography.metricSecondary, { color: colors.action }]}>
            {metricValueText(protein)}{metricUnit(protein)}
          </Text>
          <Text allowFontScaling selectable style={[typography.overline, { color: colors.textSecondary }]}>
            Protein
          </Text>
          <Text
            allowFontScaling
            selectable
            style={[
              typography.caption,
              {
                color: colors.textSecondary,
                textAlign: stackMetrics ? 'left' : 'right',
              },
            ]}
          >
            {metricGoalText(protein)}
          </Text>
        </View>
      </View>

      {percentage !== null ? (
        <View
          accessible
          accessibilityLabel="Calorie goal progress"
          accessibilityRole="progressbar"
          accessibilityValue={{ min: 0, max: 100, now: percentage, text: `${percentage} percent` }}
          style={{
            backgroundColor: colors.surfaceMuted,
            borderRadius: radii.capsule,
            height: 4,
            overflow: 'hidden',
          }}
        >
          <View
            style={{
              backgroundColor: over ? colors.destructive : colors.action,
              borderRadius: radii.capsule,
              height: 4,
              width: `${percentage}%`,
            }}
          />
        </View>
      ) : null}
    </View>
  );
}

function CompactMetric({
  code,
  metric,
  first,
}: {
  readonly code: TodayMetricCode;
  readonly metric: TodayMetric;
  readonly first: boolean;
}) {
  const colors = useThemeColors();

  return (
    <View
      accessible
      accessibilityLabel={metricAccessibilityLabel(metric)}
      style={{
        borderLeftColor: colors.border,
        borderLeftWidth: first ? 0 : 1,
        flexBasis: 76,
        flexGrow: 1,
        gap: spacing.xxs,
        minWidth: 76,
        paddingHorizontal: 10,
        paddingVertical: spacing.sm,
      }}
    >
      <Text allowFontScaling selectable style={[typography.overline, { color: colors.textSecondary }]}>
        {dashboardMetricLabels[code]}
      </Text>
      <MetricValue color={colors.textPrimary} metric={metric} unitColor={colors.textSecondary} />
      <Text allowFontScaling selectable style={[typography.caption, { color: colors.textSecondary }]}>
        {metricGoalText(metric)}
      </Text>
    </View>
  );
}

export interface NutritionDashboardProps {
  readonly metrics: readonly TodayMetric[];
}

export function NutritionDashboard({ metrics }: NutritionDashboardProps) {
  const colors = useThemeColors();
  const calories = metricForCode(metrics, 'energy-kcal');
  const protein = metricForCode(metrics, 'protein-g');
  // Protein already leads the hero above; repeating it in the strip below —
  // as the old parchment-and-macro-strip layout did — would say the same
  // number twice. The strip's job is the three metrics that don't get a hero.
  const compactCodes: readonly TodayMetricCode[] = ['fiber-g', 'carbohydrate-g', 'fat-g'];

  return (
    <View
      accessibilityLabel="Daily nutrition"
      style={{
        backgroundColor: colors.surface,
        borderColor: colors.border,
        borderCurve: 'continuous',
        borderRadius: radii.card,
        borderWidth: 1,
        overflow: 'hidden',
      }}
    >
      <EnergyHero calories={calories} protein={protein} />
      <View
        style={{
          backgroundColor: colors.surfaceMuted,
          borderTopColor: colors.border,
          borderTopWidth: 1,
          flexDirection: 'row',
          flexWrap: 'wrap',
        }}
      >
        {compactCodes.map((code, index) => (
          <CompactMetric
            code={code}
            first={index === 0}
            key={code}
            metric={metricForCode(metrics, code)}
          />
        ))}
      </View>
    </View>
  );
}

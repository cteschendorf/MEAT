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
        backgroundColor: colors.parchment,
        gap: spacing.md,
        paddingHorizontal: 20,
        paddingVertical: 18,
      }}
    >
      <Text allowFontScaling selectable style={[typography.overline, { color: colors.textSecondaryOnParchment }] }>
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
            color={colors.textOnParchment}
            hero
            metric={calories}
            unitColor={colors.textSecondaryOnParchment}
          />
          <Text
            allowFontScaling
            selectable
            style={[typography.caption, { color: colors.textSecondaryOnParchment }]}
          >
            {metricGoalText(calories)}
          </Text>
        </View>

        <View
          accessible
          accessibilityLabel={metricAccessibilityLabel(protein)}
          style={{ alignItems: stackMetrics ? 'flex-start' : 'flex-end', flexShrink: 0, gap: spacing.xxs }}
        >
          <Text allowFontScaling selectable style={[typography.metricSecondary, { color: colors.action }] }>
            {metricValueText(protein)}{metricUnit(protein)}
          </Text>
          <Text allowFontScaling selectable style={[typography.overline, { color: colors.textSecondaryOnParchment }] }>
            Protein
          </Text>
          <Text
            allowFontScaling
            selectable
            style={[
              typography.caption,
              {
                color: colors.textSecondaryOnParchment,
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
            backgroundColor: colors.parchmentMuted,
            borderRadius: radii.capsule,
            height: 3,
            overflow: 'hidden',
          }}
        >
          <View
            style={{
              backgroundColor: over
                ? colors.energyProgressOverOnParchment
                : colors.energyProgressOnParchment,
              borderRadius: radii.capsule,
              height: 3,
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
  const isProtein = code === 'protein-g';
  const valueColor = metricGoalImpact(metric).tone === 'over'
    ? colors.accentOnChrome
    : isProtein
      ? colors.accentOnChrome
      : colors.textOnChrome;

  return (
    <View
      accessible={!isProtein}
      accessibilityLabel={!isProtein ? metricAccessibilityLabel(metric) : undefined}
      accessibilityElementsHidden={isProtein}
      importantForAccessibility={isProtein ? 'no-hide-descendants' : 'auto'}
      style={{
        borderLeftColor: colors.chromeBorder,
        borderLeftWidth: first ? 0 : 1,
        flexBasis: 76,
        flexGrow: 1,
        gap: spacing.xxs,
        minWidth: 76,
        paddingHorizontal: 10,
        paddingVertical: spacing.sm,
      }}
    >
      <Text allowFontScaling selectable style={[typography.overline, { color: colors.textSecondaryOnChrome }] }>
        {dashboardMetricLabels[code]}
      </Text>
      <MetricValue color={valueColor} metric={metric} unitColor={colors.textSecondaryOnChrome} />
      <Text allowFontScaling selectable style={[typography.caption, { color: colors.textSecondaryOnChrome }] }>
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
  const compactCodes: readonly TodayMetricCode[] = [
    'protein-g',
    'fiber-g',
    'carbohydrate-g',
    'fat-g',
  ];

  return (
    <View
      accessibilityLabel="Daily nutrition"
      style={{
        borderColor: colors.parchmentBorder,
        borderCurve: 'continuous',
        borderRadius: radii.card,
        borderWidth: 1,
        overflow: 'hidden',
      }}
    >
      <EnergyHero calories={calories} protein={protein} />
      <View
        style={{
          backgroundColor: colors.macroStrip,
          borderTopColor: colors.chromeBorder,
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

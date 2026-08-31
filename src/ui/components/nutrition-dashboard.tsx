import { Text, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import type { TodayMetric, TodayMetricCode } from '@/services/today/snapshot';
import { BrandMark } from '@/ui/components/brand-mark';
import { Surface } from '@/ui/components/surface';
import {
  dashboardMetricLabels,
  metricAccessibilityLabel,
  metricForCode,
  metricGoalText,
  metricProgress,
  metricUnit,
  metricValueText,
} from '@/ui/nutrition-dashboard-model';
import { radii, spacing, typography } from '@/ui/theme/tokens';
import { useThemeColors } from '@/ui/theme/use-theme';

const calorieArcCircumference = 2 * Math.PI * 30;
const calorieArcLength = calorieArcCircumference * 0.78;

function CaloriesArc({ progress }: { readonly progress: number | null }) {
  const colors = useThemeColors();
  const normalized = progress ?? 0;
  const emberLength = calorieArcLength * normalized * 0.68;
  const yellowLength = calorieArcLength * normalized * 0.32;
  return (
    <Svg accessible={false} width={92} height={92} viewBox="0 0 80 80">
      {progress !== null ? (
        <>
          <Circle
            cx={40}
            cy={40}
            r={30}
            fill="none"
            stroke={colors.surfaceMuted}
            strokeWidth={8}
            strokeLinecap="round"
            strokeDasharray={`${calorieArcLength} ${calorieArcCircumference}`}
            transform="rotate(130 40 40)"
          />
          <Circle
            testID="calories-ember-arc"
            cx={40}
            cy={40}
            r={30}
            fill="none"
            stroke={colors.calories}
            strokeWidth={8}
            strokeLinecap="round"
            strokeDasharray={`${emberLength} ${calorieArcCircumference - emberLength}`}
            transform="rotate(130 40 40)"
          />
          <Circle
            testID="calories-yellow-orange-arc"
            cx={40}
            cy={40}
            r={30}
            fill="none"
            stroke={colors.caloriesAccent}
            strokeWidth={8}
            strokeLinecap="round"
            strokeDasharray={`${yellowLength} ${calorieArcCircumference - yellowLength}`}
            strokeDashoffset={-emberLength}
            transform="rotate(130 40 40)"
          />
        </>
      ) : null}
      <Path
        d="M41.3 19.5c2.7 8.6-5.6 11.3-4 18.1.7 3 3.3 4.7 6 4.1 5.4-1.2 7.2-7.7 5-13.1 7.9 6.4 12.4 15.8 8.6 24-3.1 6.6-10.6 10.3-18 8.7-7.7-1.6-12.9-8.4-12.2-16.1.7-7.9 7.1-12.4 16.5-21.6Z"
        fill={colors.calories}
      />
      <Path
        d="M40.8 39.3c.2 4.3-4.4 5.4-3.9 9 .3 2.2 2.5 3.6 4.8 3.1 3.1-.7 4.1-4.4 2.8-7.6 4.3 3.8 5.3 8.5 2.7 11.6-2.1 2.5-6.2 3.2-9.2 1.4-3.2-1.9-4.2-6-2.6-9.4 1.1-2.4 3.2-4.5 5.4-8.1Z"
        fill={colors.caloriesAccent}
      />
    </Svg>
  );
}

function FlatMetricIcon({ code, color }: { readonly code: TodayMetricCode; readonly color: string }) {
  if (code === 'carbohydrate-g') {
    return (
      <Svg accessible={false} testID="carbs-flat-icon" width={28} height={28} viewBox="0 0 28 28">
        <Path d="M13 25h2V7h-2v18Zm1-19C10.8 5.4 9 3.5 8.6 1c3.1.5 4.9 2.3 5.4 5Zm0 4.7c-3.3-.5-5.2-2.4-5.7-5 3.3.5 5.2 2.4 5.7 5Zm0 4.8c-3.5-.5-5.5-2.4-6-5.2 3.5.5 5.5 2.5 6 5.2Zm0 4.8c-3.4-.4-5.4-2.3-6-5.1 3.5.4 5.5 2.3 6 5.1Zm0-14.3c3.2-.6 5-2.5 5.4-5-3.1.5-4.9 2.3-5.4 5Zm0 4.7c3.3-.5 5.2-2.4 5.7-5-3.3.5-5.2 2.4-5.7 5Zm0 4.8c3.5-.5 5.5-2.4 6-5.2-3.5.5-5.5 2.5-6 5.2Zm0 4.8c3.4-.4 5.4-2.3 6-5.1-3.5.4-5.5 2.3-6 5.1Z" fill={color} />
      </Svg>
    );
  }
  if (code === 'fat-g') {
    return (
      <Svg accessible={false} testID="fat-flat-icon" width={28} height={28} viewBox="0 0 28 28">
        <Path d="M14 2.2C10.2 8.1 5.8 12.7 5.8 17.4A8.2 8.2 0 0 0 14 25.6a8.2 8.2 0 0 0 8.2-8.2C22.2 12.7 17.8 8.1 14 2.2Zm-4 15.5c.3 2.8 1.8 4.4 4.6 4.9-3.8.6-6.8-1.7-6.8-5.3 0-1.8.8-3.5 2.1-5.4-.2 2-.1 3.9.1 5.8Z" fill={color} />
      </Svg>
    );
  }
  return (
    <Svg accessible={false} testID="fiber-flat-icon" width={28} height={28} viewBox="0 0 28 28">
      <Path d="M13.6 25.5h2c-.2-4.4.3-8 1.7-10.8 4.7-.1 8.2-3.3 8.5-9.9-6.3-.2-10.2 2.8-10.5 7.3-1.1 1.7-1.8 3.7-2.2 6-1-1.4-2.2-2.6-3.5-3.6.4-3.9-2.3-6.7-7.4-7.4-.6 5.4 1.8 8.7 5.8 9.2 2.2 1.6 4 3.7 5.6 6.2v3Z" fill={color} />
    </Svg>
  );
}

function ValueLockup({ metric, primary = false }: { readonly metric: TodayMetric; readonly primary?: boolean }) {
  const colors = useThemeColors();
  const valueTypography = primary ? typography.metricPrimary : typography.metricSecondary;
  return (
    <View style={{ alignItems: 'baseline', flexDirection: 'row', gap: spacing.xxs }}>
      <Text
        allowFontScaling
        selectable
        style={[{
          fontSize: valueTypography.fontSize,
          fontVariant: ['tabular-nums'],
          fontWeight: valueTypography.fontWeight,
          lineHeight: valueTypography.lineHeight,
        }, { color: colors.textPrimary }]}
      >
        {metricValueText(metric)}
      </Text>
      <Text allowFontScaling selectable style={[typography.caption, { color: colors.textSecondary }] }>
        {metricUnit(metric)}
      </Text>
    </View>
  );
}

function ProteinCard({ metric }: { readonly metric: TodayMetric }) {
  const colors = useThemeColors();
  const progress = metricProgress(metric);
  const percentage = progress === null ? 0 : Math.round(progress * 100);
  return (
    <Surface
      tone="elevated"
      style={{
        borderColor: colors.protein,
        gap: spacing.md,
        overflow: 'hidden',
        padding: spacing.lg,
      }}
    >
      <View style={{ alignItems: 'flex-start', flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md }}>
        <View
          accessible
          accessibilityLabel={metricAccessibilityLabel(metric)}
          style={{ flex: 1, gap: spacing.xxs }}
        >
          <Text allowFontScaling selectable style={[typography.bodyStrong, { color: colors.brand }]}>Protein</Text>
          <ValueLockup metric={metric} primary />
          <Text allowFontScaling selectable style={[typography.caption, { color: colors.textSecondary }]}>
            {metricGoalText(metric)}
          </Text>
        </View>
        <BrandMark decorative size={52} />
      </View>

      {progress !== null ? (
        <View
          accessibilityRole="progressbar"
          accessibilityLabel="Protein goal progress"
          accessibilityValue={{ min: 0, max: 100, now: percentage, text: `${percentage} percent` }}
          style={{
            backgroundColor: colors.surfaceMuted,
            borderRadius: radii.capsule,
            height: 10,
            overflow: 'visible',
          }}
        >
          <View
            style={{
              backgroundColor: colors.protein,
              borderRadius: radii.capsule,
              height: 10,
              minWidth: progress > 0 ? 8 : 0,
              position: 'relative',
              width: `${percentage}%`,
            }}
          >
            <View
              style={{
                backgroundColor: colors.proteinAccent,
                borderColor: colors.surface,
                borderRadius: radii.capsule,
                borderWidth: 2,
                height: 16,
                position: 'absolute',
                right: -8,
                top: -3,
                width: 16,
              }}
            />
          </View>
        </View>
      ) : null}
    </Surface>
  );
}

function CaloriesCard({ metric }: { readonly metric: TodayMetric }) {
  const colors = useThemeColors();
  const progress = metricProgress(metric);
  const percentage = progress === null ? undefined : Math.round(progress * 100);
  return (
    <Surface
      style={{
        alignItems: 'center',
        boxShadow: `0 6px 18px ${colors.shadow}`,
        flexDirection: 'row',
        gap: spacing.md,
        padding: spacing.md,
      }}
    >
      <View
        {...(percentage === undefined
          ? { accessible: false as const }
          : {
              accessibilityRole: 'progressbar' as const,
              accessibilityLabel: 'Calorie goal progress',
              accessibilityValue: { min: 0, max: 100, now: percentage, text: `${percentage} percent` },
            })}
      >
        <CaloriesArc progress={progress} />
      </View>
      <View
        accessible
        accessibilityLabel={metricAccessibilityLabel(metric)}
        style={{ flex: 1, gap: spacing.xxs }}
      >
        <Text allowFontScaling selectable style={[typography.bodyStrong, { color: colors.caloriesLabel }]}>Calories</Text>
        <ValueLockup metric={metric} />
        <Text allowFontScaling selectable style={[typography.caption, { color: colors.textSecondary }]}>
          {metricGoalText(metric)}
        </Text>
      </View>
    </Surface>
  );
}

function FlatMetricCard({ metric }: { readonly metric: TodayMetric }) {
  const colors = useThemeColors();
  const displayColor = metric.code === 'carbohydrate-g'
    ? colors.carbs
    : metric.code === 'fat-g'
      ? colors.fat
      : colors.fiber;
  const labelColor = metric.code === 'carbohydrate-g'
    ? colors.carbsLabel
    : metric.code === 'fat-g'
      ? colors.fatLabel
      : colors.fiberLabel;
  return (
    <View
      accessible
      accessibilityLabel={metricAccessibilityLabel(metric)}
      style={{
        backgroundColor: colors.surface,
        borderColor: colors.border,
        borderTopColor: displayColor,
        borderTopWidth: 4,
        borderWidth: 1,
        borderCurve: 'continuous',
        borderRadius: radii.md,
        flexBasis: 100,
        flexGrow: 1,
        gap: spacing.xs,
        minHeight: 118,
        padding: spacing.md,
      }}
    >
      <View style={{ alignItems: 'center', flexDirection: 'row', gap: spacing.xs }}>
        <FlatMetricIcon code={metric.code} color={displayColor} />
        <Text allowFontScaling selectable style={[typography.caption, { color: labelColor, fontWeight: '600' }] }>
          {dashboardMetricLabels[metric.code]}
        </Text>
      </View>
      <View style={{ alignItems: 'baseline', flexDirection: 'row', gap: spacing.xxs }}>
        <Text
          allowFontScaling
          selectable
          style={[{
            fontSize: typography.metricCompact.fontSize,
            fontVariant: ['tabular-nums'],
            fontWeight: typography.metricCompact.fontWeight,
            lineHeight: typography.metricCompact.lineHeight,
          }, { color: colors.textPrimary }]}
        >
          {metricValueText(metric)}
        </Text>
        <Text allowFontScaling selectable style={[typography.caption, { color: colors.textSecondary }] }>
          {metricUnit(metric)}
        </Text>
      </View>
      <Text allowFontScaling selectable style={[typography.caption, { color: colors.textSecondary }] }>
        {metricGoalText(metric)}
      </Text>
    </View>
  );
}

export interface NutritionDashboardProps {
  readonly metrics: readonly TodayMetric[];
}

export function NutritionDashboard({ metrics }: NutritionDashboardProps) {
  const macroCodes: readonly TodayMetricCode[] = ['carbohydrate-g', 'fat-g', 'fiber-g'];
  return (
    <View accessibilityLabel="Daily nutrition" style={{ gap: spacing.sm }}>
      <ProteinCard metric={metricForCode(metrics, 'protein-g')} />
      <CaloriesCard metric={metricForCode(metrics, 'energy-kcal')} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
        {macroCodes.map((code) => <FlatMetricCard key={code} metric={metricForCode(metrics, code)} />)}
      </View>
    </View>
  );
}

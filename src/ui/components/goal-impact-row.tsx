import { memo } from 'react';
import { Text, View } from 'react-native';

import { goalImpactAccessibilityLabel, type GoalImpact, type GoalImpactTone } from '@/ui/goal-impact';
import { radii, spacing, typography } from '@/ui/theme/tokens';
import type { ThemeColors } from '@/ui/theme/colors';
import { useThemeColors } from '@/ui/theme/use-theme';

/**
 * One nutrient's standing against its target, and what a pending food does to it.
 *
 * The four target modes get four readings rather than four identical bars — see
 * `goal-impact.ts` for why that distinction is not cosmetic. An untargeted
 * nutrient renders no track at all: an empty bar would say "zero percent of your
 * goal", and there is no goal.
 */

const trackHeight = 14;

function toneColor(tone: GoalImpactTone, colors: ThemeColors): string {
  if (tone === 'over') return colors.destructive;
  if (tone === 'caution') return colors.warning;
  if (tone === 'good') return colors.positive;
  return colors.brand;
}

export interface GoalImpactRowProps {
  readonly impact: GoalImpact;
}

function GoalImpactRowView({ impact }: GoalImpactRowProps) {
  const colors = useThemeColors();
  const fill = toneColor(impact.tone, colors);
  const currentWidth = `${impact.currentFraction * 100}%` as const;
  const pendingWidth = `${impact.pendingFraction * 100}%` as const;

  return (
    <View
      accessible
      accessibilityLabel={goalImpactAccessibilityLabel(impact)}
      style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}
    >
      <Text
        allowFontScaling
        numberOfLines={1}
        style={[typography.caption, { color: colors.textSecondary, width: 62 }]}
      >
        {impact.label}
      </Text>

      {impact.shape === 'untargeted' ? (
        <Text allowFontScaling style={[typography.caption, { color: colors.textSecondary, flex: 1 }]}>
          {impact.summary}
        </Text>
      ) : (
        <>
          <View
            accessible={false}
            style={{
              flex: 1,
              height: trackHeight,
              borderRadius: radii.sm,
              backgroundColor: colors.surfaceMuted,
              borderColor: colors.border,
              borderWidth: 1,
              overflow: 'hidden',
              flexDirection: 'row',
            }}
          >
            {/* A range goal marks the zone to land in, because "more" stops
                being better once you are inside it. */}
            {impact.band ? (
              <View
                style={{
                  position: 'absolute',
                  left: `${impact.band.start * 100}%`,
                  width: `${(impact.band.end - impact.band.start) * 100}%`,
                  top: 0,
                  bottom: 0,
                  backgroundColor: colors.surface,
                  borderLeftWidth: 1,
                  borderRightWidth: 1,
                  borderColor: colors.borderStrong,
                }}
              />
            ) : null}
            <View style={{ width: currentWidth, backgroundColor: fill, opacity: 0.45 }} />
            {/* The pending share is the same colour at full strength, so the
                eye reads "this is the part you are about to add". */}
            <View style={{ width: pendingWidth, backgroundColor: fill }} />
          </View>

          <View style={{ width: 116, alignItems: 'flex-end' }}>
            <Text
              allowFontScaling
              numberOfLines={1}
              style={[
                typography.caption,
                { color: impact.tone === 'over' ? colors.destructive : colors.textSecondary },
              ]}
            >
              {impact.summary}
            </Text>
            {impact.delta ? (
              <Text allowFontScaling numberOfLines={1} style={[typography.caption, { color: fill }]}>
                {impact.delta}
              </Text>
            ) : null}
          </View>
        </>
      )}
    </View>
  );
}

export const GoalImpactRow = memo(GoalImpactRowView);

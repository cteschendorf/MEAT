import { memo } from 'react';
import { Pressable, Text, View } from 'react-native';

import type { FoodResultRow } from '@/ui/food-search-results';
import { fontFamilies, minimumTouchTarget, radii, spacing, typography } from '@/ui/theme/tokens';
import { useThemeColors } from '@/ui/theme/use-theme';

export interface FoodResultRowProps {
  readonly row: FoodResultRow;
  readonly disabled?: boolean;
  /** Adds the row at its default portion, with no detour through an editor. */
  readonly onAdd: (row: FoodResultRow) => void;
  /** Opens portion refinement for the rare case the default is wrong. */
  readonly onRefine: (row: FoodResultRow) => void;
}

/**
 * One search result.
 *
 * The five metrics render in canonical protein-first order with protein
 * accented, because deciding between two chicken entries is the choice this row
 * exists to support and it used to show no macros at all (THI-307). Provenance
 * rides on the row rather than a section header, so results can be presented as
 * one list without merging databases (THI-313).
 */
function FoodResultRowView({ row, disabled = false, onAdd, onRefine }: FoodResultRowProps) {
  const colors = useThemeColors();
  const metricLabel = row.metrics
    .map((metric) => `${metric.text} ${metric.label}`)
    .join(', ');

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
        paddingVertical: spacing.sm,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${row.name}. ${metricLabel}. ${row.portionLabel}. ${row.sourceLabel}.`}
        accessibilityHint="Opens portion options for this food."
        disabled={disabled}
        onPress={() => onRefine(row)}
        style={{ flex: 1, gap: 2, opacity: disabled ? 0.45 : 1 }}
      >
        <Text allowFontScaling style={[typography.body, { color: colors.textPrimary }]}>
          {row.nameSegments.map((segment, index) => (
            <Text
              // Segments are positional slices of one string; index is stable here.
              key={`${index}-${segment.text}`}
              style={segment.matched ? typography.bodyStrong : undefined}
            >
              {segment.text}
            </Text>
          ))}
        </Text>

        {/* One line, wrapping: metrics, then the portion they describe, then
            where the record came from. Protein is the only accented value.
            This is the THI-313 anatomy — the metrics and the portion belong
            together because the numbers mean nothing without the weight they
            are for, and the source is a quiet tag rather than a section. */}
        <Text allowFontScaling style={[typography.caption, { color: colors.textSecondary }]}>
          {row.metrics.map((metric, index) => (
            <Text key={metric.code}>
              {index > 0 ? ' · ' : ''}
              <Text
                style={
                  metric.code === 'protein-g' && metric.known
                    ? { color: colors.brand, fontFamily: fontFamilies.bodySemibold }
                    : undefined
                }
              >
                {metric.text} {metric.label}
              </Text>
            </Text>
          ))}
          {'  —  '}
          {row.portionLabel}
          {' · '}
          <Text style={{ color: colors.textSecondary }}>{row.sourceLabel}</Text>
        </Text>
      </Pressable>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Add ${row.name}, ${row.portionLabel}`}
        disabled={disabled}
        onPress={() => onAdd(row)}
        style={{
          width: minimumTouchTarget,
          height: minimumTouchTarget,
          borderRadius: radii.capsule,
          borderWidth: 1,
          borderColor: colors.border,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: disabled ? 0.45 : 1,
        }}
      >
        <Text allowFontScaling={false} style={[typography.title3, { color: colors.textPrimary }]}>
          +
        </Text>
      </Pressable>
    </View>
  );
}

export const FoodResultRowItem = memo(FoodResultRowView);

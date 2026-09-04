import { Pressable, Text, TextInput, View } from 'react-native';

import type { Food } from '@/domain';
import type { MealItemId } from '@/domain/shared/ids';
import type { MealDraft } from '@/services/meals/meal-composer';
import { foodSourceNames, sourceForFood } from '@/ui/composer/food-sources';
import { coreMetricLine } from '@/ui/core-metrics';
import type { DraftSummary } from '@/ui/meal-draft-summary';
import { minimumTouchTarget, radii, spacing, typography } from '@/ui/theme/tokens';
import { useThemeColors } from '@/ui/theme/use-theme';

export interface ComposerStagedItemsProps {
  readonly draft: MealDraft;
  readonly foodById: ReadonlyMap<Food['id'], Food>;
  readonly summary: DraftSummary | null;
  readonly busy: boolean;
  readonly expanded: boolean;
  readonly onToggle: () => void;
  readonly onChangeGrams: (itemId: MealItemId, value: string) => void;
  readonly onRemove: (itemId: MealItemId) => void;
}

/**
 * What is in the meal so far, above whichever mode is open.
 *
 * Staging belongs to the sheet, not to one tab of it (THI-315): a food added
 * by scanning and a food added by searching are in the same meal, and there
 * should be one place that says so. Keeping it here rather than inside Search
 * is what makes that true.
 *
 * It collapses to a single line, because on a two-food meal the totals are the
 * whole answer and the portion fields are just noise between the user and the
 * next food they want to add.
 */
export function ComposerStagedItems({
  draft,
  foodById,
  summary,
  busy,
  expanded,
  onToggle,
  onChangeGrams,
  onRemove,
}: ComposerStagedItemsProps) {
  const colors = useThemeColors();
  const count = draft.items.length;
  if (count === 0) return null;

  return (
    <View
      style={{
        backgroundColor: colors.surfaceMuted,
        borderBottomColor: colors.border,
        borderBottomWidth: 1,
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={`${count} food${count === 1 ? '' : 's'} in this meal`}
        accessibilityHint={expanded ? 'Collapses the list.' : 'Opens the list to change portions.'}
        onPress={onToggle}
        style={(state) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.xs,
          minHeight: minimumTouchTarget,
          paddingHorizontal: spacing.md,
          opacity: state.pressed ? 0.7 : 1,
        })}
      >
        <Text allowFontScaling style={[typography.caption, { color: colors.textSecondary }]}>
          {count} food{count === 1 ? '' : 's'}
        </Text>
        {summary ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.xs, flex: 1 }}>
            {summary.totals.map((metric) => (
              <Text
                key={metric.code}
                allowFontScaling
                style={[
                  metric.code === 'protein-g' ? typography.bodyStrong : typography.caption,
                  {
                    color:
                      metric.code === 'protein-g' && metric.known ? colors.brand : colors.textSecondary,
                  },
                ]}
              >
                {metric.text} {metric.label}
              </Text>
            ))}
          </View>
        ) : (
          <View style={{ flex: 1 }} />
        )}
        <Text allowFontScaling style={[typography.caption, { color: colors.brand }]}>
          {expanded ? 'Hide' : 'Edit'}
        </Text>
      </Pressable>

      {summary?.unavailableCount ? (
        <Text
          allowFontScaling
          style={[typography.caption, { color: colors.textSecondary, paddingHorizontal: spacing.md }]}
        >
          {summary.unavailableCount} item{summary.unavailableCount === 1 ? '' : 's'} could not be counted.
        </Text>
      ) : null}

      {expanded
        ? draft.items.map((item) => {
            const food = foodById.get(item.foodId);
            const itemSummary = summary?.items.find((entry) => entry.itemId === item.id);
            return (
              <View
                key={item.id}
                style={{
                  gap: spacing.xxs,
                  paddingHorizontal: spacing.md,
                  paddingVertical: spacing.xs,
                  borderTopColor: colors.border,
                  borderTopWidth: 1,
                }}
              >
                <Text allowFontScaling style={[typography.bodyStrong, { color: colors.textPrimary }]}>
                  {food?.name ?? 'Unavailable food'}
                </Text>
                <Text allowFontScaling style={[typography.caption, { color: colors.textSecondary }]}>
                  {foodSourceNames[item.foodRef?.sourceId ?? sourceForFood(food ?? { id: item.foodId })]}
                  {itemSummary ? ` · ${coreMetricLine(itemSummary.metrics)}` : ''}
                </Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
                  <TextInput
                    accessibilityLabel={`Portion for ${food?.name ?? 'unavailable food'} in grams`}
                    // A serving-based portion stores no gram weight, so the
                    // resolved value is the only honest thing to show here.
                    defaultValue={String(itemSummary?.gramWeight ?? item.portion.gramWeight ?? 100)}
                    keyboardType="decimal-pad"
                    onEndEditing={(event) => onChangeGrams(item.id, event.nativeEvent.text)}
                    style={[
                      typography.body,
                      {
                        flex: 1,
                        color: colors.textPrimary,
                        backgroundColor: colors.surface,
                        borderColor: colors.borderStrong,
                        borderWidth: 1,
                        borderRadius: radii.sm,
                        padding: spacing.xs,
                      },
                    ]}
                  />
                  <Text allowFontScaling style={[typography.body, { color: colors.textSecondary }]}>g</Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Remove ${food?.name ?? 'this food'}`}
                    disabled={busy}
                    onPress={() => onRemove(item.id)}
                    style={(state) => ({
                      minHeight: minimumTouchTarget,
                      justifyContent: 'center',
                      paddingHorizontal: spacing.sm,
                      opacity: busy ? 0.45 : state.pressed ? 0.7 : 1,
                    })}
                  >
                    <Text allowFontScaling style={[typography.body, { color: colors.destructive }]}>
                      Remove
                    </Text>
                  </Pressable>
                </View>
              </View>
            );
          })
        : null}
    </View>
  );
}

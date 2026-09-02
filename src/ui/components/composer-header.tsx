import { Pressable, ScrollView, Text, View } from 'react-native';

import { presetMealNames } from '@/ui/composer/meal-context';
import type { RunningTotal } from '@/ui/composer/running-total';
import { minimumTouchTarget, radii, spacing, typography } from '@/ui/theme/tokens';
import { useThemeColors } from '@/ui/theme/use-theme';

export interface ComposerHeaderProps {
  readonly occurredAt: Date;
  readonly title: string;
  /** The name this hour usually goes by, highlighted but never applied. */
  readonly suggestedMealName: (typeof presetMealNames)[number];
  readonly runningTotal: RunningTotal;
  readonly locked: boolean;
  readonly onClose: () => void;
  readonly onOpenTimePicker: () => void;
  readonly onChooseMealName: (name: string | null) => void;
}

/**
 * The part of the sheet that never changes with the mode.
 *
 * Close, when the meal happened, what it is called, and where the day stands —
 * visible from every tab, because all four are properties of the meal rather
 * than of the way a food was found (THI-328).
 *
 * The running total in particular has to be here rather than in the scroll: it
 * answers "does this fit", and it used to leave the screen at exactly the
 * moment that question gets asked (THI-307).
 */
export function ComposerHeader({
  occurredAt,
  title,
  suggestedMealName,
  runningTotal,
  locked,
  onClose,
  onOpenTimePicker,
  onChooseMealName,
}: ComposerHeaderProps) {
  const colors = useThemeColors();

  return (
    <View
      style={{
        backgroundColor: colors.surface,
        borderBottomColor: colors.border,
        borderBottomWidth: 1,
        paddingTop: spacing.xs,
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.xs,
          paddingHorizontal: spacing.xs,
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close without saving"
          onPress={onClose}
          style={(state) => ({
            minHeight: minimumTouchTarget,
            minWidth: minimumTouchTarget,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: state.pressed ? 0.6 : 1,
          })}
        >
          <Text allowFontScaling style={[typography.title3, { color: colors.textSecondary }]}>
            ✕
          </Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Meal time, ${occurredAt.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`}
          accessibilityHint="Opens meal details: time, name, location, notes and photos."
          disabled={locked}
          onPress={onOpenTimePicker}
          style={(state) => ({
            flex: 1,
            minHeight: minimumTouchTarget,
            justifyContent: 'center',
            opacity: state.pressed ? 0.6 : 1,
          })}
        >
          <Text allowFontScaling numberOfLines={1} style={[typography.bodyStrong, { color: colors.textPrimary }]}>
            {occurredAt.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
          </Text>
        </Pressable>
      </View>

      {/* The day's standing, pinned. Protein leads: this is a protein-first
          tracker, and the reference app's calorie-first chip answers a
          different question (THI-307). */}
      <View
        accessible
        accessibilityLabel={runningTotal.accessibilityLabel}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: spacing.xs,
          paddingHorizontal: spacing.md,
          paddingBottom: spacing.xs,
        }}
      >
        <Text allowFontScaling style={[typography.bodyStrong, { color: colors.protein }]}>
          {runningTotal.headline}
        </Text>
        <Text allowFontScaling style={[typography.caption, { color: colors.textSecondary, flex: 1 }]}>
          {runningTotal.detail}
        </Text>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{
          gap: spacing.xxs,
          paddingHorizontal: spacing.xs,
          paddingBottom: spacing.xs,
        }}
      >
        <MealNameChip
          label="None"
          selected={!title}
          suggested={false}
          disabled={locked}
          onPress={() => onChooseMealName(null)}
        />
        {presetMealNames.map((name) => (
          <MealNameChip
            key={name}
            label={name}
            selected={title === name}
            // Highlighted, not chosen. The clock is not entitled to claim what
            // a meal was: someone eating dinner at 3am has not had a snack.
            suggested={!title && name === suggestedMealName}
            disabled={locked}
            onPress={() => onChooseMealName(name)}
          />
        ))}
      </ScrollView>
    </View>
  );
}

interface ChipProps {
  readonly label: string;
  readonly selected: boolean;
  readonly suggested: boolean;
  readonly disabled: boolean;
  readonly onPress: () => void;
}

function MealNameChip({ label, selected, suggested, disabled, onPress }: ChipProps) {
  const colors = useThemeColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      accessibilityLabel={suggested ? `${label}, suggested for this time of day` : label}
      disabled={disabled}
      onPress={onPress}
      style={(state) => ({
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: minimumTouchTarget,
        paddingHorizontal: spacing.sm,
        borderRadius: radii.capsule,
        borderWidth: 1,
        borderColor: selected || suggested ? colors.brand : colors.border,
        backgroundColor: selected ? colors.brand : 'transparent',
        opacity: disabled ? 0.45 : state.pressed ? 0.7 : 1,
      })}
    >
      <Text
        allowFontScaling
        style={[
          selected ? typography.bodyStrong : typography.body,
          { color: selected ? colors.textOnAction : colors.textPrimary },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

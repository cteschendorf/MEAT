import { Pressable, ScrollView, Text, View } from 'react-native';

import type { presetMealNames } from '@/ui/composer/meal-context';
import type { RunningTotal } from '@/ui/composer/running-total';
import { minimumTouchTarget, radii, spacing, typography } from '@/ui/theme/tokens';
import { useThemeColors } from '@/ui/theme/use-theme';

export interface ComposerHeaderProps {
  readonly occurredAt: Date;
  readonly title: string;
  /** The name this hour usually goes by, offered when none is chosen yet. */
  readonly suggestedMealName: (typeof presetMealNames)[number];
  readonly runningTotal: RunningTotal;
  readonly locked: boolean;
  readonly onClose: () => void;
  /** Opens the details sheet: time, name, location, notes, photos. */
  readonly onOpenDetails: () => void;
  /** Accepts the suggested name in one tap. */
  readonly onAcceptSuggestedName: () => void;
}

/**
 * One row of chips: close, when, how the day stands, what the meal is called.
 *
 * It was three rows — a close-and-time row, a running-total row, and a row of
 * meal-name chips — which put forty-odd points of chrome between the top of the
 * screen and the tab row. The reference app does the same job in one row, and
 * the reason it can is that each chip is a summary that opens something rather
 * than the thing itself (THI-328).
 *
 * The meal-name chip carries the one interaction worth keeping on the surface.
 * With no name chosen it shows the hour's suggestion OUTLINED, and a tap
 * accepts it — an outline is a proposal, a fill is a decision, and the clock
 * is not entitled to make the decision for someone eating dinner at 3am. Once
 * a name is chosen the chip is filled and a tap opens the details sheet to
 * change it.
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
  onOpenDetails,
  onAcceptSuggestedName,
}: ComposerHeaderProps) {
  const colors = useThemeColors();
  const time = occurredAt.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

  return (
    <View
      style={{
        backgroundColor: colors.surface,
        borderBottomColor: colors.border,
        borderBottomWidth: 1,
      }}
    >
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          flexGrow: 1,
          alignItems: 'center',
          gap: spacing.xs,
          paddingHorizontal: spacing.xs,
          paddingVertical: spacing.xs,
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

        <Chip
          label={time}
          accessibilityLabel={`Meal time, ${occurredAt.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`}
          accessibilityHint="Opens meal details."
          disabled={locked}
          onPress={onOpenDetails}
        />

        {/* Protein leads: this is a protein-first tracker, and the reference
            app's calorie-first chip answers a different question. */}
        <Chip
          label={runningTotal.headline}
          accessibilityLabel={runningTotal.accessibilityLabel}
          accent
          disabled={locked}
          onPress={onOpenDetails}
        />

        {title ? (
          <Chip
            label={title}
            accessibilityLabel={`Meal name, ${title}`}
            accessibilityHint="Opens meal details to change it."
            filled
            disabled={locked}
            onPress={onOpenDetails}
          />
        ) : (
          <Chip
            label={suggestedMealName}
            accessibilityLabel={`${suggestedMealName}, suggested for this time of day`}
            accessibilityHint="Names the meal. Open meal details to pick a different name."
            proposed
            disabled={locked}
            onPress={onAcceptSuggestedName}
          />
        )}
      </ScrollView>
    </View>
  );
}

interface ChipProps {
  readonly label: string;
  readonly accessibilityLabel: string;
  readonly accessibilityHint?: string;
  /** Brand-tinted text, for the one number the app is about. */
  readonly accent?: boolean;
  /** Solid: a choice already made. */
  readonly filled?: boolean;
  /** Outlined in brand: a suggestion a tap would accept. */
  readonly proposed?: boolean;
  readonly disabled: boolean;
  readonly onPress: () => void;
}

function Chip({
  label,
  accessibilityLabel,
  accessibilityHint,
  accent = false,
  filled = false,
  proposed = false,
  disabled,
  onPress,
}: ChipProps) {
  const colors = useThemeColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      {...(accessibilityHint ? { accessibilityHint } : {})}
      accessibilityState={{ disabled, selected: filled }}
      disabled={disabled}
      onPress={onPress}
      style={(state) => ({
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: minimumTouchTarget - spacing.xs,
        paddingHorizontal: spacing.sm,
        borderRadius: radii.capsule,
        borderWidth: 1,
        borderColor: filled || proposed ? colors.brand : colors.border,
        backgroundColor: filled ? colors.brand : colors.surfaceMuted,
        opacity: disabled ? 0.45 : state.pressed ? 0.7 : 1,
      })}
    >
      <Text
        allowFontScaling
        numberOfLines={1}
        style={[
          filled || accent ? typography.bodyStrong : typography.body,
          {
            color: filled
              ? colors.textOnAction
              : accent
                ? colors.protein
                : colors.textPrimary,
          },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

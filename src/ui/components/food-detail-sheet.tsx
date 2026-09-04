import { useState } from 'react';
import { Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import type { FoodCandidate, MassUnitPreference } from '@/domain';
import { isVolumeUnit } from '@/domain';
import type { FoodServingId } from '@/domain/shared/ids';
import { ActionButton } from '@/ui/components/action-button';
import { GoalImpactRow } from '@/ui/components/goal-impact-row';
import {
  defaultAmountForChoice,
  defaultPortionChoice,
  goalImpactsForDetail,
  gramsForChoice,
  hasAnyTarget,
  metricsForDetail,
  parseQuantity,
  portionChoicesFor,
  portionSummary,
  servingIdForChoice,
  type DayStanding,
} from '@/ui/food-detail-model';
import { minimumTouchTarget, radii, spacing, typography } from '@/ui/theme/tokens';
import { useThemeColors } from '@/ui/theme/use-theme';

/**
 * The food detail sheet.
 *
 * Choosing a portion used to happen in a panel rendered after the entire results
 * list — same scroll, no anchor — so with up to 48 results the control sat some
 * three thousand points below the row that opened it. There was no modal
 * anywhere in the app to put it in; this is that modal (THI-306).
 *
 * Quantity is the primary control. The service layer has accepted
 * `{servingId, quantity}` since THI-308, but no surface ever emitted a quantity
 * other than 1, so "2 chicken breasts" stayed unreachable. This is where that
 * number comes from.
 */

export interface FoodDetailSheetProps {
  readonly candidate: FoodCandidate | null;
  readonly sourceLabel: string;
  readonly favorite: boolean;
  /** The day so far, including anything already in the draft. */
  readonly standings: readonly DayStanding[];
  /** How many foods are waiting in the draft, for the secondary action. */
  readonly pendingCount: number;
  /** The unit typed amounts start in, from Settings. */
  readonly preferredMassUnit?: MassUnitPreference;
  readonly busy: boolean;
  readonly onClose: () => void;
  readonly onToggleFavorite: (candidate: FoodCandidate) => void;
  readonly onAdd: (
    candidate: FoodCandidate,
    portion: { gramWeight: number; servingId: FoodServingId | undefined; quantity: number },
  ) => void;
  readonly onLogAll: () => void;
}

export function FoodDetailSheet(props: FoodDetailSheetProps) {
  // Remounting per food keeps quantity and serving from leaking between foods,
  // and keeps every hook below unconditional on a present candidate.
  if (!props.candidate) return null;
  return <FoodDetailSheetBody {...props} candidate={props.candidate} key={props.candidate.food.id} />;
}

function FoodDetailSheetBody({
  candidate,
  sourceLabel,
  favorite,
  standings,
  pendingCount,
  preferredMassUnit = 'g',
  busy,
  onClose,
  onToggleFavorite,
  onAdd,
  onLogAll,
}: FoodDetailSheetProps & { readonly candidate: FoodCandidate }) {
  const colors = useThemeColors();
  const opening = defaultPortionChoice(candidate, preferredMassUnit);
  const [quantityText, setQuantityText] = useState(() => String(defaultAmountForChoice(opening)));
  // `null` means "the food's own preference", which is not the same as the
  // weight option's absent serving id.
  const [choiceKey, setChoiceKey] = useState<string | null>(null);

  const choices = portionChoicesFor(candidate, preferredMassUnit);
  const choice = choices.find((entry) => entry.key === choiceKey) ?? opening;

  const quantity = parseQuantity(quantityText);
  const gramWeight = quantity === null ? null : gramsForChoice(choice, quantity);

  const detail = gramWeight === null ? null : metricsForDetail(candidate.food, gramWeight);
  const impacts = goalImpactsForDetail(standings, detail?.facts ?? null);

  const name = candidate.food.brand
    ? `${candidate.food.brand} ${candidate.food.name}`
    : candidate.food.name;
  const canAdd = !busy && quantity !== null && gramWeight !== null && gramWeight > 0;

  return (
    <Modal
      visible
      animationType="slide"
      transparent
      // Android's hardware back is the same gesture as the chevron; both leave
      // the search list exactly as it was.
      onRequestClose={onClose}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close food details"
        onPress={onClose}
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' }}
      />
      <View
        style={{
          maxHeight: '86%',
          backgroundColor: colors.surface,
          borderTopLeftRadius: radii.lg,
          borderTopRightRadius: radii.lg,
          borderTopWidth: 1,
          borderColor: colors.border,
        }}
      >
        <View
          accessible={false}
          style={{
            alignSelf: 'center',
            width: 38,
            height: 4,
            borderRadius: radii.capsule,
            backgroundColor: colors.borderStrong,
            marginTop: spacing.xs,
          }}
        />

        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing.xs,
            paddingHorizontal: spacing.md,
            paddingVertical: spacing.sm,
          }}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back to results"
            onPress={onClose}
            style={{
              width: minimumTouchTarget,
              height: minimumTouchTarget,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text allowFontScaling={false} style={[typography.title3, { color: colors.textSecondary }]}>
              ‹
            </Text>
          </Pressable>
          <Text
            accessibilityRole="header"
            allowFontScaling
            style={[typography.bodyStrong, { color: colors.textPrimary, flex: 1 }]}
          >
            {name}
          </Text>
        </View>

        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: spacing.md, paddingTop: 0, gap: spacing.md }}
        >
          {/* Protein leads and is the only accented value: choosing between two
              chicken entries is the decision this sheet exists to support. */}
          <View
            accessible
            accessibilityLabel={`${detail?.metrics.map((metric) => `${metric.text} ${metric.label}`).join(', ') ?? ''}. ${portionSummary(choice, quantity ?? 1)}.`}
            style={{ flexDirection: 'row', alignItems: 'flex-end', gap: spacing.md, flexWrap: 'wrap' }}
          >
            {detail?.metrics.map((metric) => {
              const lead = metric.code === 'protein-g';
              const color = !metric.known
                ? colors.textSecondary
                : metric.code === 'protein-g'
                  ? colors.proteinAccent
                  : metric.code === 'energy-kcal'
                    ? colors.caloriesLabel
                    : metric.code === 'carbohydrate-g'
                      ? colors.carbsLabel
                      : metric.code === 'fat-g'
                        ? colors.fatLabel
                        : colors.fiberLabel;
              return (
                <View key={metric.code} style={{ gap: 2 }}>
                  <Text
                    allowFontScaling
                    style={[
                      lead ? typography.metricSecondary : typography.title3,
                      { fontVariant: ['tabular-nums'] },
                      { color },
                    ]}
                  >
                    {metric.text}
                  </Text>
                  <Text allowFontScaling style={[typography.caption, { color: colors.textSecondary }]}>
                    {metric.label}
                  </Text>
                </View>
              );
            })}
          </View>

          <Text allowFontScaling style={[typography.caption, { color: colors.textSecondary }]}>
            {portionSummary(choice, quantity ?? 1)} · {sourceLabel}
          </Text>

          <ActionButton
            label={favorite ? 'Remove favorite' : 'Favorite'}
            tone="secondary"
            disabled={busy}
            onPress={() => onToggleFavorite(candidate)}
          />

          <View style={{ gap: spacing.sm }}>
            <Text
              accessibilityRole="header"
              allowFontScaling
              style={[typography.bodyStrong, { color: colors.textPrimary }]}
            >
              If you add this
            </Text>
            {hasAnyTarget(impacts) ? null : (
              <Text allowFontScaling style={[typography.caption, { color: colors.textSecondary }]}>
                You have not set any targets yet. Set them under Me to see where a food lands.
              </Text>
            )}
            {impacts.map((impact) => <GoalImpactRow key={impact.code} impact={impact} />)}
          </View>

          <View style={{ gap: spacing.sm }}>
            <Text
              accessibilityRole="header"
              allowFontScaling
              style={[typography.bodyStrong, { color: colors.textPrimary }]}
            >
              How much
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
              <TextInput
                accessibilityLabel="Amount"
                keyboardType="decimal-pad"
                value={quantityText}
                onChangeText={setQuantityText}
                selectTextOnFocus
                style={[
                  typography.bodyStrong,
                  {
                    color: colors.textPrimary,
                    borderColor: quantity === null ? colors.destructive : colors.borderStrong,
                    borderWidth: 1.5,
                    borderRadius: radii.sm,
                    paddingHorizontal: spacing.sm,
                    paddingVertical: spacing.xs,
                    minWidth: 72,
                    textAlign: 'center',
                  },
                ]}
              />
              <Text allowFontScaling style={[typography.body, { color: colors.textSecondary, flex: 1 }]}>
                {choice.kind === 'serving' ? `× ${choice.label}` : choice.label}
              </Text>
            </View>
            {quantity === null ? (
              <Text
                accessibilityLiveRegion="polite"
                allowFontScaling
                style={[typography.caption, { color: colors.destructive }]}
              >
                Enter an amount greater than zero.
              </Text>
            ) : null}

            <Text allowFontScaling style={[typography.caption, { color: colors.textSecondary }]}>
              {choices.some((entry) => entry.kind === 'unit' && isVolumeUnit(entry.unit))
                ? 'Measure in a serving, a weight, or a volume.'
                : 'Measure in a serving or a weight.'}
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
              {choices.map((entry) => {
                const active = entry.key === choice.key;
                return (
                  <Pressable
                    key={entry.key}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={`Measure in ${entry.label}`}
                    disabled={busy}
                    onPress={() => {
                      setChoiceKey(entry.key);
                      // 2 breasts is not 2 ounces. Re-anchor rather than carry
                      // a number that meant something else.
                      setQuantityText(String(defaultAmountForChoice(entry)));
                    }}
                    style={{
                      borderWidth: 1,
                      borderColor: active ? colors.brand : colors.border,
                      backgroundColor: active ? colors.surfaceMuted : 'transparent',
                      borderRadius: radii.capsule,
                      paddingHorizontal: spacing.sm,
                      paddingVertical: spacing.xs,
                      minHeight: minimumTouchTarget - 12,
                      justifyContent: 'center',
                    }}
                  >
                    <Text
                      allowFontScaling
                      style={[
                        typography.caption,
                        { color: active ? colors.brand : colors.textSecondary },
                      ]}
                    >
                      {entry.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        </ScrollView>

        {/* Both actions stay visible. Add commits this food to the event; Log
            commits the event. Keeping them side by side is what makes the two
            stages legible instead of a button that silently disables (THI-315). */}
        <View
          style={{
            flexDirection: 'row',
            gap: spacing.sm,
            padding: spacing.md,
            borderTopWidth: 1,
            borderTopColor: colors.border,
            backgroundColor: colors.surfaceMuted,
          }}
        >
          <View style={{ flex: 1 }}>
            <ActionButton
              label={busy ? 'Adding…' : 'Add to event'}
              disabled={!canAdd}
              onPress={() => {
                if (!canAdd || gramWeight === null || quantity === null) return;
                onAdd(candidate, { gramWeight, servingId: servingIdForChoice(choice), quantity });
              }}
            />
          </View>
          {pendingCount > 0 ? (
            <View style={{ flex: 1 }}>
              <ActionButton
                label={`Log ${pendingCount} food${pendingCount === 1 ? '' : 's'}`}
                tone="secondary"
                disabled={busy}
                onPress={onLogAll}
              />
            </View>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

import { ScrollView, Text, View } from 'react-native';

import type { FoodCandidate } from '@/domain/food/source';
import type { FoodServingId } from '@/domain/shared/ids';
import type { FoodSuggestion } from '@/services/logging/food-suggestions';
import { FoodResultRowItem } from '@/ui/components/food-result-row';
import { ScreenState } from '@/ui/components/screen-state';
import { foodSourceNames, sourceForFood } from '@/ui/composer/food-sources';
import type { PreSearchSections } from '@/ui/composer/pre-search-sections';
import type { FoodResultTier } from '@/ui/food-search-results';
import { minimumTouchTarget, spacing, typography } from '@/ui/theme/tokens';
import { useThemeColors } from '@/ui/theme/use-theme';
import { ActionButton } from '@/ui/components/action-button';

export interface EntryModeSearchProps {
  readonly submittedQuery: string;
  readonly tiers: readonly FoodResultTier[];
  readonly suggestions: readonly FoodSuggestion[];
  readonly sections: PreSearchSections;
  readonly busy: boolean;
  readonly onAddSuggestion: (suggestion: FoodSuggestion) => void;
  readonly onAdd: (
    candidate: FoodCandidate,
    gramWeight: number,
    servingId?: FoodServingId,
  ) => void;
  readonly onRefine: (candidate: FoodCandidate) => void;
}

/**
 * The Search tab's body: what we can offer before anyone types, and the ranked
 * results once they do.
 *
 * Before typing, the reference app shows time-of-day picks and a recents list.
 * We have both already — `listSuggestions` ranks by usage *and* by the hour —
 * so this is a matter of showing what was always computed, under a heading
 * that names the ranking rather than the clock (THI-328).
 *
 * Section order is the search's own answer, not a fixed provider order: the
 * heading holding the best match leads, and rows never cross a heading
 * (THI-313).
 */
export function EntryModeSearch({
  submittedQuery,
  tiers,
  suggestions,
  sections,
  busy,
  onAddSuggestion,
  onAdd,
  onRefine,
}: EntryModeSearchProps) {
  const colors = useThemeColors();

  if (!submittedQuery) {
    if (!suggestions.length) {
      return (
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: spacing.md }}
        >
          <ScreenState
            title="Start typing"
            message="Search any food by name, or scan a barcode. Foods you log will show up here next time."
          />
        </ScrollView>
      );
    }

    // "Picks" are ranked for this hour; "Latest" is the same list in the order
    // it was last eaten. One list, two useful orderings, no second query.
    const latest = [...suggestions]
      .filter((suggestion) => suggestion.lastLoggedAt)
      .sort((left, right) => (right.lastLoggedAt ?? '').localeCompare(left.lastLoggedAt ?? ''));

    return (
      <ScrollView
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={{ paddingVertical: spacing.xs }}
      >
        <SuggestionSection
          title={sections.picksTitle}
          suggestions={suggestions.slice(0, 6)}
          busy={busy}
          onAdd={onAddSuggestion}
        />
        {latest.length ? (
          <SuggestionSection
            title={sections.latestTitle}
            suggestions={latest.slice(0, 6)}
            busy={busy}
            onAdd={onAddSuggestion}
          />
        ) : null}
      </ScrollView>
    );
  }

  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      contentContainerStyle={{ paddingVertical: spacing.xs, gap: spacing.xs }}
    >
      {tiers.length ? (
        tiers.map((tier) => (
          <View key={tier.id} style={{ gap: spacing.xxs }}>
            <Text
              accessibilityRole="header"
              allowFontScaling
              style={[
                typography.caption,
                {
                  color: colors.textSecondary,
                  paddingHorizontal: spacing.md,
                  paddingTop: spacing.xs,
                },
              ]}
            >
              {tier.title.toUpperCase()}
            </Text>
            {tier.loading ? (
              <Text
                allowFontScaling
                style={[typography.caption, { color: colors.textSecondary, paddingHorizontal: spacing.md }]}
              >
                Searching…
              </Text>
            ) : null}
            {tier.notes.map((note) => (
              <Text
                key={note}
                allowFontScaling
                style={[typography.caption, { color: colors.textSecondary, paddingHorizontal: spacing.md }]}
              >
                {note}
              </Text>
            ))}
            {tier.rows.map((row) => (
              <FoodResultRowItem
                key={row.key}
                row={row}
                disabled={busy}
                onAdd={(added) => onAdd(added.candidate, added.gramWeight, added.servingId)}
                onRefine={(refined) => onRefine(refined.candidate)}
              />
            ))}
          </View>
        ))
      ) : (
        <View style={{ padding: spacing.md }}>
          <ScreenState
            title="No matches"
            message="Try a different word, or add it yourself from the Quick Add tab."
          />
        </View>
      )}
    </ScrollView>
  );
}

interface SectionProps {
  readonly title: string;
  readonly suggestions: readonly FoodSuggestion[];
  readonly busy: boolean;
  readonly onAdd: (suggestion: FoodSuggestion) => void;
}

function SuggestionSection({ title, suggestions, busy, onAdd }: SectionProps) {
  const colors = useThemeColors();
  return (
    <View style={{ gap: spacing.xxs }}>
      <Text
        accessibilityRole="header"
        allowFontScaling
        style={[
          typography.caption,
          { color: colors.textSecondary, paddingHorizontal: spacing.md, paddingTop: spacing.xs },
        ]}
      >
        {title.toUpperCase()}
      </Text>
      {suggestions.map((suggestion) => (
        <View
          key={suggestion.food.id}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing.xs,
            minHeight: minimumTouchTarget,
            paddingHorizontal: spacing.md,
            paddingVertical: spacing.xxs,
          }}
        >
          <View style={{ flex: 1, gap: 2 }}>
            <Text allowFontScaling numberOfLines={2} style={[typography.body, { color: colors.textPrimary }]}>
              {suggestion.food.name}
            </Text>
            <Text allowFontScaling style={[typography.caption, { color: colors.textSecondary }]}>
              {foodSourceNames[sourceForFood(suggestion.food)]} · {Math.round(suggestion.suggestedGramWeight)} g
            </Text>
          </View>
          <ActionButton
            label="+"
            accessibilityLabel={`Add ${suggestion.food.name}, ${Math.round(suggestion.suggestedGramWeight)} grams`}
            disabled={busy}
            onPress={() => onAdd(suggestion)}
            style={{ paddingHorizontal: spacing.md }}
          />
        </View>
      ))}
    </View>
  );
}

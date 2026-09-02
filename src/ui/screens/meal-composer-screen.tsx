import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';

import type { FoodCandidate } from '@/domain/food/source';
import type { ISODateTime } from '@/domain/shared/ids';
import type { AppServices } from '@/services';
import {
  ActionButton,
  ScreenState,
  Surface,
  minimumTouchTarget,
  radii,
  spacing,
  typography,
  useThemeColors,
} from '@/ui';
import { FoodDetailSheet } from '@/ui/components/food-detail-sheet';
import { FoodResultRowItem } from '@/ui/components/food-result-row';
import { foodSourceNames, sourceForFood } from '@/ui/composer/food-sources';
import { presetMealNames, shouldRevealContext } from '@/ui/composer/meal-context';
import { combineDatePart, isAcceptableMealTime } from '@/ui/composer/meal-time';
import { useComposerActions } from '@/ui/composer/use-composer-actions';
import { useComposerContext } from '@/ui/composer/use-composer-context';
import { useComposerSession, type ComposerParams } from '@/ui/composer/use-composer-session';
import { useComposerStatus } from '@/ui/composer/use-composer-status';
import { useDayStandings } from '@/ui/composer/use-day-standings';
import { useFoodSearch, MAX_QUERY_LENGTH } from '@/ui/composer/use-food-search';
import { useFoodSuggestions } from '@/ui/composer/use-food-suggestions';
import { coreMetricLine } from '@/ui/core-metrics';
import type { MealComposerSession } from '@/ui/meal-composer-session';
import { summarizeDraft } from '@/ui/meal-draft-summary';

/**
 * The meal composer.
 *
 * This screen used to hold twelve concerns, twenty-six pieces of state and
 * 1,340 lines in one function (THI-316). The concerns now live in
 * `src/ui/composer/` as hooks and pure modules, and what remains here is the
 * arrangement: which handler each control calls, and what the screen looks
 * like. That separation is what makes the tabbed entry surface possible —
 * tabs need pieces to reassemble, not a monolith to grow into (THI-328).
 */
export function MealComposerScreen() {
  const colors = useThemeColors();
  const router = useRouter();
  const params = useLocalSearchParams<{
    draftId?: string;
    mealId?: string;
    occurredAt?: string;
  }>();
  const [initialParams] = useState<ComposerParams>(() => ({
    draftId: typeof params.draftId === 'string' ? params.draftId : undefined,
    mealId: typeof params.mealId === 'string' ? params.mealId : undefined,
    occurredAt: typeof params.occurredAt === 'string' ? params.occurredAt : undefined,
  }));

  const status = useComposerStatus();
  const context = useComposerContext();
  const foods = useFoodSuggestions();
  const [selected, setSelected] = useState<FoodCandidate | null>(null);
  const [savedWithoutNavigation, setSavedWithoutNavigation] = useState(false);
  const [deletionTokenWithoutNavigation, setDeletionTokenWithoutNavigation] =
    useState<string | null>(null);

  const { setMessage } = status;
  const { hydrate } = context;
  const { refresh: refreshSuggestions } = foods;

  const onOpened = useCallback(
    (services: AppServices, opened: MealComposerSession) => {
      context.setShowContext(
        shouldRevealContext(opened.draft, {
          existing: opened.existingMedia.length,
          staged: opened.stagedPhotos.length,
        }),
      );
      // Swallowed deliberately. A suggestion strip that failed to load is a
      // missing convenience; reporting it as "the composer is unavailable",
      // which is what the bootstrap's own catch would have said, is worse.
      void refreshSuggestions(services).catch(() => undefined);
    },
    // `context.setShowContext` is a stable setter; the rest is stable by
    // construction. Listing `context` whole would re-run this on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [refreshSuggestions],
  );

  const composer = useComposerSession({
    params: initialParams,
    gate: status.gate,
    onMessage: setMessage,
    onAdoptContext: hydrate,
    onOpened,
  });
  const { services, session, foodById } = composer;

  const onSearchStarted = useCallback(() => {
    setSelected(null);
    setMessage(null);
  }, [setMessage]);

  const search = useFoodSearch(services, foods.favoriteIds, setMessage, onSearchStarted);

  // What the event adds up to as it is built, so the number the app exists to
  // produce is visible while the user works (THI-307).
  const draftSummary = useMemo(
    () => (session ? summarizeDraft(session.draft, foodById) : null),
    [session, foodById],
  );

  const day = useDayStandings(
    services,
    draftSummary?.totalFacts ?? null,
    session?.draft.items.length ?? 0,
  );

  const inputStyle = useMemo(
    () => [
      typography.body,
      {
        color: colors.textPrimary,
        backgroundColor: colors.surface,
        borderColor: colors.borderStrong,
        borderWidth: 1,
        borderRadius: radii.sm,
        padding: spacing.sm,
      },
    ],
    [colors],
  );

  const actions = useComposerActions({
    composer,
    status,
    rawContextFor: context.rawContextFor,
    favoriteIds: foods.favoriteIds,
    refreshSuggestions,
    mealId: initialParams.mealId,
    onSelect: setSelected,
    onSavedWithoutNavigation: () => setSavedWithoutNavigation(true),
    onDeletedWithoutNavigation: setDeletionTokenWithoutNavigation,
  });

  function chooseTime(event: DateTimePickerEvent, chosen?: Date): void {
    const part = context.pickerMode;
    context.setPickerMode(null);
    if (!part || event.type === 'dismissed' || !chosen || !session) return;
    const next = combineDatePart(new Date(session.draft.context.occurredAt), chosen, part);
    if (!isAcceptableMealTime(next)) {
      setMessage('Meal time cannot be in the future.');
      return;
    }
    actions.updateContext({ occurredAt: next.toISOString() as ISODateTime });
  }

  if (savedWithoutNavigation) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, padding: spacing.md }}>
        <Surface>
          <ScreenState title="Meal saved" message="Your meal is safely on the timeline." />
          <ActionButton label="Return to Today" onPress={() => router.dismissTo('/')} />
        </Surface>
      </View>
    );
  }

  if (deletionTokenWithoutNavigation) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, padding: spacing.md }}>
        <Surface>
          <ScreenState title="Meal deleted" message="Undo remains available for 10 seconds." role="alert" />
          <ActionButton
            label="Open Undo"
            onPress={() =>
              router.replace({ pathname: '/meal-deleted', params: { token: deletionTokenWithoutNavigation } })
            }
          />
        </Surface>
      </View>
    );
  }

  if (!services || !session) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        {status.message
          ? <ScreenState title="Meal composer unavailable" message={status.message} role="alert" />
          : <ScreenState title="Preparing your meal" message="Opening food sources and private history…" />}
      </View>
    );
  }

  const occurredAt = new Date(session.draft.context.occurredAt);
  const totalPhotos = session.existingMedia.length + session.stagedPhotos.length;

  return (
    <KeyboardAvoidingView
      // Numeric keypads have no return key, so a field the keyboard covers is a
      // field with no way out of it (THI-314).
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={{ flex: 1, backgroundColor: colors.background }}
    >
      {/* The running total stays put while foods are chosen. It used to live
          inside the scroll, so it left the screen at exactly the moment it was
          useful (THI-307). Protein leads it: this is a protein-first tracker,
          and the reference app's calorie-first chip is not our answer. */}
      <View
        accessible
        accessibilityLabel={day.runningTotal.accessibilityLabel}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: spacing.sm,
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.sm,
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
          backgroundColor: colors.surface,
        }}
      >
        <Text allowFontScaling style={[typography.bodyStrong, { color: colors.protein }]}>
          {day.runningTotal.headline}
        </Text>
        <Text allowFontScaling style={[typography.caption, { color: colors.textSecondary, flex: 1 }]}>
          {day.runningTotal.detail}
        </Text>
      </View>

      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={{ padding: spacing.md, gap: spacing.md, backgroundColor: colors.background }}
      >
        <Text accessibilityRole="header" allowFontScaling style={[typography.title1, { color: colors.brandStrong }]}>
          {initialParams.mealId ? 'Edit meal event' : 'Build a meal event'}
        </Text>
        <Text allowFontScaling style={[typography.body, { color: colors.textSecondary }]}>
          Add every food from this meal, snack, or sitting, then save it once on your timeline.
        </Text>

        <Surface tone="elevated">
          <Text accessibilityRole="header" allowFontScaling style={[typography.title3, { color: colors.textPrimary }]}>
            Event foods · {session.draft.items.length}
          </Text>
          {draftSummary && session.draft.items.length ? (
            <View style={{ gap: spacing.xs }}>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.xs }}>
                {draftSummary.totals.map((metric) => (
                  <Text
                    key={metric.code}
                    allowFontScaling
                    style={[
                      metric.code === 'protein-g' ? typography.bodyStrong : typography.caption,
                      {
                        color:
                          metric.code === 'protein-g' && metric.known
                            ? colors.brand
                            : colors.textSecondary,
                      },
                    ]}
                  >
                    {metric.text} {metric.label}
                  </Text>
                ))}
              </View>
              {draftSummary.unavailableCount ? (
                <Text allowFontScaling style={[typography.caption, { color: colors.textSecondary }]}>
                  {draftSummary.unavailableCount} item
                  {draftSummary.unavailableCount === 1 ? '' : 's'} could not be counted.
                </Text>
              ) : null}
            </View>
          ) : null}
          {session.draft.items.length === 0 ? (
            <ScreenState title="No foods yet" message="Search, scan, create, or choose a saved meal below." />
          ) : (
            session.draft.items.map((item) => {
              const food = foodById.get(item.foodId);
              const itemSummary = draftSummary?.items.find((entry) => entry.itemId === item.id);
              return (
                <View
                  key={item.id}
                  style={{ gap: spacing.xs, borderTopColor: colors.border, borderTopWidth: 1, paddingTop: spacing.sm }}
                >
                  <Text allowFontScaling style={[typography.bodyStrong, { color: colors.textPrimary }]}>
                    {food?.name ?? 'Unavailable food'}
                  </Text>
                  <Text allowFontScaling style={[typography.caption, { color: colors.textSecondary }]}>
                    {foodSourceNames[item.foodRef?.sourceId ?? sourceForFood(food ?? { id: item.foodId })]}
                  </Text>
                  {itemSummary ? (
                    <Text allowFontScaling style={[typography.caption, { color: colors.textSecondary }]}>
                      {coreMetricLine(itemSummary.metrics)}
                    </Text>
                  ) : null}
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                    <TextInput
                      accessibilityLabel={`Portion for ${food?.name ?? 'unavailable food'} in grams`}
                      // A serving-based portion stores no gram weight, so the
                      // resolved value is the only honest thing to show here.
                      defaultValue={String(itemSummary?.gramWeight ?? item.portion.gramWeight ?? 100)}
                      keyboardType="decimal-pad"
                      onEndEditing={(event) => actions.updateItemGrams(item.id, event.nativeEvent.text)}
                      style={[inputStyle, { flex: 1 }]}
                    />
                    <Text allowFontScaling style={[typography.body, { color: colors.textSecondary }]}>g</Text>
                    <ActionButton
                      label="Remove"
                      tone="secondary"
                      disabled={status.busy}
                      onPress={() => actions.removeItem(item.id)}
                    />
                  </View>
                </View>
              );
            })
          )}
        </Surface>

        {foods.suggestions.length ? (
          <View style={{ gap: spacing.sm }}>
            <Text accessibilityRole="header" allowFontScaling style={[typography.title3, { color: colors.textPrimary }]}>
              Quick add
            </Text>
            {foods.suggestions.slice(0, 4).map((suggestion) => (
              <Surface key={suggestion.food.id}>
                <Text allowFontScaling style={[typography.bodyStrong, { color: colors.textPrimary }]}>
                  {suggestion.food.name}
                </Text>
                <Text allowFontScaling style={[typography.caption, { color: colors.textSecondary }]}>
                  {foodSourceNames[sourceForFood(suggestion.food)]} · {Math.round(suggestion.suggestedGramWeight)} g
                </Text>
                <ActionButton
                  label={`Add ${Math.round(suggestion.suggestedGramWeight)} g`}
                  disabled={status.busy}
                  onPress={() => void actions.addSuggestion(suggestion)}
                />
              </Surface>
            ))}
          </View>
        ) : null}

        <Surface>
          <Text accessibilityRole="header" allowFontScaling style={[typography.title3, { color: colors.textPrimary }]}>
            Find a food
          </Text>
          <TextInput
            accessibilityLabel="Search foods"
            accessibilityHint="Results update as you type."
            placeholder="Search foods"
            placeholderTextColor={colors.textSecondary}
            value={search.query}
            onChangeText={search.setQuery}
            maxLength={MAX_QUERY_LENGTH}
            onSubmitEditing={search.searchNow}
            returnKeyType="search"
            style={inputStyle}
          />
          <ActionButton
            label="Saved meals & recipes"
            tone="secondary"
            disabled={status.busy}
            onPress={() => actions.openComposerChild('/meals-recipes')}
          />
          <ActionButton
            label="Scan packaged food"
            tone="secondary"
            disabled={status.busy}
            onPress={() => actions.openComposerChild('/scan-barcode')}
          />
          <ActionButton
            label="Create a food manually"
            tone="secondary"
            disabled={status.busy}
            onPress={() => actions.openComposerChild('/manual-food')}
          />
        </Surface>

        {search.submittedQuery ? (
          <View style={{ gap: spacing.md }}>
            <Text accessibilityRole="header" allowFontScaling style={[typography.title2, { color: colors.textPrimary }]}>
              Results for “{search.submittedQuery}”
            </Text>
            {search.tiers.length ? (
              search.tiers.map((tier) => (
                <Surface key={tier.id}>
                  <Text accessibilityRole="header" allowFontScaling style={[typography.title3, { color: colors.brand }]}>
                    {tier.title}
                  </Text>
                  {tier.loading ? <ScreenState title="Searching…" message="Checking your food sources." /> : null}
                  {tier.notes.map((note) => (
                    <Text key={note} allowFontScaling style={[typography.caption, { color: colors.textSecondary }]}>
                      {note}
                    </Text>
                  ))}
                  {tier.rows.map((row) => (
                    <FoodResultRowItem
                      key={row.key}
                      row={row}
                      disabled={status.busy}
                      onAdd={(added) => void actions.addCandidate(added.candidate, added.gramWeight, added.servingId)}
                      onRefine={(refined) => {
                        setSelected(refined.candidate);
                        setMessage(null);
                      }}
                    />
                  ))}
                </Surface>
              ))
            ) : (
              <ScreenState title="No matches" message="Try a different word, or create the food manually." />
            )}
          </View>
        ) : null}

        <Surface>
          <Text accessibilityRole="header" allowFontScaling style={[typography.title3, { color: colors.textPrimary }]}>
            When
          </Text>
          <Text allowFontScaling style={[typography.bodyStrong, { color: colors.textPrimary }]}>
            {occurredAt.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
          </Text>
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <ActionButton
              label="Change date"
              tone="secondary"
              disabled={status.busy}
              style={{ flex: 1 }}
              onPress={() => { if (!status.locked) context.setPickerMode('date'); }}
            />
            <ActionButton
              label="Change time"
              tone="secondary"
              disabled={status.busy}
              style={{ flex: 1 }}
              onPress={() => { if (!status.locked) context.setPickerMode('time'); }}
            />
          </View>
          {context.pickerMode ? (
            <DateTimePicker
              value={occurredAt}
              mode={context.pickerMode}
              maximumDate={new Date()}
              onChange={chooseTime}
            />
          ) : null}
        </Surface>

        <Surface>
          <Text accessibilityRole="header" allowFontScaling style={[typography.title3, { color: colors.textPrimary }]}>
            Meal name · optional
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
            <ActionButton
              label="None"
              tone={context.titleText ? 'secondary' : 'primary'}
              disabled={status.busy}
              onPress={() => {
                if (status.locked) return;
                context.setCustomMealName(false);
                context.setTitleText('');
                actions.updateContext({ title: null });
              }}
            />
            {presetMealNames.map((name) => (
              <ActionButton
                key={name}
                label={name}
                tone={context.titleText === name ? 'primary' : 'secondary'}
                disabled={status.busy}
                onPress={() => {
                  if (status.locked) return;
                  context.setCustomMealName(false);
                  context.setTitleText(name);
                  actions.updateContext({ title: name });
                }}
              />
            ))}
            <ActionButton
              label="Custom"
              tone={context.customMealName ? 'primary' : 'secondary'}
              disabled={status.busy}
              onPress={() => { if (!status.locked) context.setCustomMealName(true); }}
            />
          </View>
          {context.customMealName ? (
            <TextInput
              accessibilityLabel="Custom meal name"
              placeholder="Meal name"
              placeholderTextColor={colors.textSecondary}
              value={context.titleText}
              maxLength={80}
              onChangeText={context.setTitleText}
              onBlur={() => actions.updateContext({ title: context.titleText || null })}
              style={inputStyle}
            />
          ) : null}
        </Surface>

        <Surface>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: context.showContext }}
            onPress={() => { if (!status.locked) context.setShowContext((visible) => !visible); }}
            style={{ minHeight: minimumTouchTarget, justifyContent: 'center' }}
          >
            <Text allowFontScaling style={[typography.title3, { color: colors.brand }]}>
              {context.showContext ? 'Hide context' : 'Add context'}
            </Text>
          </Pressable>
          {context.showContext ? (
            <View style={{ gap: spacing.sm }}>
              <TextInput
                accessibilityLabel="Meal location"
                accessibilityHint="Optional manual label. MEAT does not request your device location."
                placeholder="Location (optional)"
                placeholderTextColor={colors.textSecondary}
                value={context.locationText}
                maxLength={120}
                onChangeText={context.setLocationText}
                onBlur={() =>
                  actions.updateContext({ location: context.locationText ? { label: context.locationText } : null })
                }
                style={inputStyle}
              />
              <TextInput
                accessibilityLabel="Meal notes"
                placeholder="Notes (optional)"
                placeholderTextColor={colors.textSecondary}
                value={context.captionText}
                maxLength={500}
                multiline
                onChangeText={context.setCaptionText}
                onBlur={() => actions.updateContext({ caption: context.captionText || null })}
                style={[inputStyle, { minHeight: 96, textAlignVertical: 'top' }]}
              />
              <Text allowFontScaling style={[typography.bodyStrong, { color: colors.textPrimary }]}>
                Photos · {totalPhotos}/5
              </Text>
              <Text allowFontScaling style={[typography.caption, { color: colors.textSecondary }]}>
                Photos stay private on this device. MEAT re-encodes them without EXIF metadata.
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
                {[...session.existingMedia, ...session.stagedPhotos].map((photo) => (
                  <View key={photo.id} style={{ width: 112, gap: spacing.xs }}>
                    <Image
                      source={{ uri: photo.uri }}
                      accessibilityLabel="Meal photo"
                      style={{ width: 112, height: 84, borderRadius: radii.sm }}
                      contentFit="cover"
                    />
                    <ActionButton
                      label="Remove photo"
                      tone="secondary"
                      disabled={status.busy}
                      onPress={() => actions.removePhoto(photo.id)}
                    />
                  </View>
                ))}
              </View>
              <ActionButton
                label="Take photo"
                tone="secondary"
                disabled={status.busy || totalPhotos >= 5}
                onPress={() => void actions.addPhotos('camera')}
              />
              <ActionButton
                label="Choose from library"
                tone="secondary"
                disabled={status.busy || totalPhotos >= 5}
                onPress={() => void actions.addPhotos('library')}
              />
            </View>
          ) : null}
        </Surface>

        {status.message ? (
          <Text
            accessibilityLiveRegion="polite"
            selectable
            style={[
              typography.body,
              { color: status.message.includes('added') ? colors.positive : colors.destructive },
            ]}
          >
            {status.message}
          </Text>
        ) : null}

        <ActionButton
          label={
            status.busyAction === 'confirm'
              ? 'Saving event…'
              : initialParams.mealId
                ? 'Save changes'
                : 'Save meal event'
          }
          disabled={status.busy || session.draft.items.length === 0}
          onPress={() => void actions.confirm()}
        />
        <ActionButton label="Cancel" tone="secondary" disabled={status.busy} onPress={() => void actions.cancel()} />
      </ScrollView>

      <FoodDetailSheet
        candidate={selected}
        sourceLabel={selected ? foodSourceNames[selected.ref.sourceId] : ''}
        favorite={selected ? foods.favoriteIds.has(selected.food.id) : false}
        standings={day.standings}
        preferredMassUnit={day.massUnit}
        pendingCount={session.draft.items.length}
        busy={status.busy}
        onClose={() => setSelected(null)}
        onToggleFavorite={(candidate) => void actions.toggleFavorite(candidate)}
        onAdd={(candidate, portion) => void actions.addFromSheet(candidate, portion)}
        onLogAll={() => {
          setSelected(null);
          void actions.confirm();
        }}
      />
    </KeyboardAvoidingView>
  );
}

import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { TextInput, View } from 'react-native';

import type { FoodCandidate } from '@/domain/food/source';
import type { ISODateTime } from '@/domain/shared/ids';
import type { AppServices } from '@/services';
import {
  ActionButton,
  ScreenState,
  Surface,
  radii,
  spacing,
  typography,
  useThemeColors,
} from '@/ui';
import { ComposerFooter } from '@/ui/components/composer-footer';
import { ComposerHeader } from '@/ui/components/composer-header';
import { ComposerKeyboardAvoider } from '@/ui/components/composer-keyboard-avoider';
import { ComposerMealDetails } from '@/ui/components/composer-meal-details';
import { ComposerStagedItems } from '@/ui/components/composer-staged-items';
import { ComposerTabBar } from '@/ui/components/composer-tab-bar';
import { EntryModePlaceholder } from '@/ui/components/entry-mode-placeholder';
import { EntryModeSearch } from '@/ui/components/entry-mode-search';
import { FoodDetailSheet } from '@/ui/components/food-detail-sheet';
import { commitAction } from '@/ui/composer/commit-action';
import { defaultEntryTab, type EntryTabId } from '@/ui/composer/entry-tabs';
import { foodSourceNames } from '@/ui/composer/food-sources';
import { shouldRevealContext } from '@/ui/composer/meal-context';
import { combineDatePart, isAcceptableMealTime } from '@/ui/composer/meal-time';
import { preSearchSections } from '@/ui/composer/pre-search-sections';
import { useComposerActions } from '@/ui/composer/use-composer-actions';
import { useComposerContext } from '@/ui/composer/use-composer-context';
import { useComposerSession, type ComposerParams } from '@/ui/composer/use-composer-session';
import { useComposerStatus } from '@/ui/composer/use-composer-status';
import { useDayStandings } from '@/ui/composer/use-day-standings';
import { useFoodSearch, MAX_QUERY_LENGTH } from '@/ui/composer/use-food-search';
import { useFoodSuggestions } from '@/ui/composer/use-food-suggestions';
import type { MealComposerSession } from '@/ui/meal-composer-session';
import { summarizeDraft } from '@/ui/meal-draft-summary';

/**
 * One entry surface: five ways into a meal, one draft, one commit (THI-328).
 *
 * The shape is header, tabs, the meal so far, the active mode, footer. Only
 * the mode changes when a tab is pressed; the draft, the running total and the
 * commit button belong to the sheet and outlive every switch.
 *
 * That is the point of the restructure rather than a side effect of it. While
 * each mode was its own route, the draft had to survive a navigation boundary
 * by id, which is the mechanism behind THI-309's silent fork and THI-319's
 * teleport into a blank form. A tab has no id to lose.
 *
 * Scan and Library are still routes today and their tabs say so. The shell is
 * what lets them move in; moving them is the next step, not this one.
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
  const [tab, setTab] = useState<EntryTabId>(defaultEntryTab);
  const [stagedExpanded, setStagedExpanded] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
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

  const draftSummary = useMemo(
    () => (session ? summarizeDraft(session.draft, foodById) : null),
    [session, foodById],
  );

  const day = useDayStandings(
    services,
    draftSummary?.totalFacts ?? null,
    session?.draft.items.length ?? 0,
  );

  // Computed once per mount rather than per render: the heading over the picks
  // should not change under the user's thumb because a keystroke crossed 11am.
  const [sections] = useState(() => preSearchSections());

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

  function chooseMealName(name: string | null): void {
    if (status.locked) return;
    context.setCustomMealName(false);
    context.setTitleText(name ?? '');
    actions.updateContext({ title: name });
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
  const commit = commitAction({
    stagedCount: session.draft.items.length,
    saving: status.busyAction === 'confirm',
    editing: Boolean(initialParams.mealId),
    busy: status.busy,
  });

  return (
    <ComposerKeyboardAvoider
      // The footer holds the mode's input and the commit button, so pushing the
      // whole sheet up is what keeps both in the thumb zone. Numeric keypads
      // have no return key: a field the keyboard covers has no way out (THI-314).
      style={{ flex: 1, backgroundColor: colors.background }}
    >
      <ComposerHeader
        occurredAt={occurredAt}
        title={context.titleText}
        suggestedMealName={sections.suggestedMealName}
        runningTotal={day.runningTotal}
        locked={status.locked}
        onClose={() => void actions.cancel()}
        onOpenDetails={() => setDetailsOpen(true)}
        onAcceptSuggestedName={() => chooseMealName(sections.suggestedMealName)}
      />

      <ComposerMealDetails
        visible={detailsOpen}
        occurredAt={occurredAt}
        customName={context.customMealName}
        titleText={context.titleText}
        suggestedMealName={sections.suggestedMealName}
        onChooseMealName={chooseMealName}
        locationText={context.locationText}
        captionText={context.captionText}
        photos={[...session.existingMedia, ...session.stagedPhotos]}
        busy={status.busy}
        onClose={() => setDetailsOpen(false)}
        onOpenPicker={(mode) => { if (!status.locked) context.setPickerMode(mode); }}
        onUseCustomName={() => { if (!status.locked) context.setCustomMealName(true); }}
        onChangeTitle={context.setTitleText}
        onCommitTitle={() => actions.updateContext({ title: context.titleText || null })}
        onChangeLocation={context.setLocationText}
        onCommitLocation={() =>
          actions.updateContext({
            location: context.locationText ? { label: context.locationText } : null,
          })
        }
        onChangeCaption={context.setCaptionText}
        onCommitCaption={() => actions.updateContext({ caption: context.captionText || null })}
        onAddPhoto={(source) => void actions.addPhotos(source)}
        onRemovePhoto={actions.removePhoto}
        picker={
          context.pickerMode ? (
            <DateTimePicker
              value={occurredAt}
              mode={context.pickerMode}
              maximumDate={new Date()}
              onChange={chooseTime}
            />
          ) : null
        }
      />

      <ComposerTabBar active={tab} onSelect={setTab} />

      {/* The meal so far sits above every mode, not inside one. A food added by
          scanning and a food added by searching are in the same meal, and one
          place should say so (THI-315). */}
      <ComposerStagedItems
        draft={session.draft}
        foodById={foodById}
        summary={draftSummary}
        busy={status.busy}
        expanded={stagedExpanded}
        onToggle={() => setStagedExpanded((open) => !open)}
        onChangeGrams={actions.updateItemGrams}
        onRemove={actions.removeItem}
      />

      <View style={{ flex: 1 }}>
        {tab === 'search' ? (
          <EntryModeSearch
            submittedQuery={search.submittedQuery}
            tiers={search.tiers}
            suggestions={foods.suggestions}
            sections={sections}
            busy={status.busy}
            onAddSuggestion={(suggestion) => void actions.addSuggestion(suggestion)}
            onAdd={(candidate, gramWeight, servingId) =>
              void actions.addCandidate(candidate, gramWeight, servingId)
            }
            onRefine={(candidate) => {
              setSelected(candidate);
              setMessage(null);
            }}
          />
        ) : null}

        {tab === 'scan' ? (
          <EntryModePlaceholder
            id="scan"
            busy={status.busy}
            detail="Scanning still opens its own screen. Bringing the camera in here is what removes the round trip."
            routeLabel="Scan a barcode"
            onOpenRoute={() => actions.openComposerChild('/scan-barcode')}
          />
        ) : null}

        {tab === 'quick-add' ? (
          <EntryModePlaceholder
            id="quick-add"
            busy={status.busy}
            detail="For food no database will have. Today this opens the manual form; a conversational version is specified in THI-329."
            routeLabel="Create a food manually"
            onOpenRoute={() => actions.openComposerChild('/manual-food')}
          />
        ) : null}

        {tab === 'library' ? (
          <EntryModePlaceholder
            id="library"
            busy={status.busy}
            detail="Your foods, saved meals and recipes. Still its own screen for now."
            routeLabel="Open saved meals & recipes"
            onOpenRoute={() => actions.openComposerChild('/meals-recipes')}
          />
        ) : null}

        {tab === 'ai' ? <EntryModePlaceholder id="ai" busy={status.busy} /> : null}
      </View>

      <ComposerFooter
        message={status.message}
        commit={commit}
        onCommit={() => void actions.confirm()}
        input={
          tab === 'search' ? (
            <TextInput
              accessibilityLabel="Search foods"
              accessibilityHint="Results update as you type."
              placeholder="Search for a food"
              placeholderTextColor={colors.textSecondary}
              value={search.query}
              onChangeText={search.setQuery}
              maxLength={MAX_QUERY_LENGTH}
              onSubmitEditing={search.searchNow}
              returnKeyType="search"
              style={[
                typography.body,
                {
                  color: colors.textPrimary,
                  backgroundColor: colors.background,
                  borderColor: colors.borderStrong,
                  borderWidth: 1,
                  borderRadius: radii.capsule,
                  paddingHorizontal: spacing.md,
                  paddingVertical: spacing.sm,
                },
              ]}
            />
          ) : null
        }
      />

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
    </ComposerKeyboardAvoider>
  );
}

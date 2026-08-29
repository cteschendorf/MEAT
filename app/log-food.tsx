import { Link, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ScrollView, Text, TextInput, View } from 'react-native';

import type { Food } from '@/domain';
import type {
  FoodCandidate,
  FoodPortion,
  FoodSearchGroup,
  FoodSourceId,
} from '@/domain/food/source';
import { sourceIdFromFoodId } from '@/domain/food/source';
import type { FoodId, ISODateTime } from '@/domain/shared/ids';
import type { AppServices } from '@/services';
import { openAppServices } from '@/services';
import { ExclusiveActionGate } from '@/services/actions/exclusive-action';
import { candidateFromFood } from '@/services/logging/food-discovery';
import type { FoodSuggestion } from '@/services/logging/food-suggestions';
import {
  ActionButton,
  ScreenState,
  Surface,
  spacing,
  typography,
  useThemeColors,
} from '@/ui';

const foodSources: readonly {
  id: FoodSourceId;
  name: string;
  detail: string;
}[] = [
  { id: 'personal', name: 'My foods', detail: 'Foods you create and foods from your own history.' },
  { id: 'usda-core', name: 'USDA — on device', detail: 'Offline Foundation, FNDDS, and SR Legacy foods.' },
  { id: 'usda-fdc', name: 'USDA — online', detail: 'FoodData Central results for the long tail.' },
  { id: 'open-food-facts', name: 'Open Food Facts', detail: 'Independent packaged-food records.' },
];

const sourceNameById: Readonly<Record<FoodSourceId, string>> = {
  personal: 'My foods',
  'usda-core': 'USDA — on device',
  'usda-fdc': 'USDA — online',
  'open-food-facts': 'Open Food Facts',
};

function portionText(portion: FoodPortion): string {
  const grams = portion.gramWeight === undefined ? '' : ` · ${Math.round(portion.gramWeight * 10) / 10} g`;
  return `${portion.label}${grams}`;
}
function candidatePortionSummary(candidate: FoodCandidate): string {
  const portions = candidate.portions.slice(0, 3).map(portionText);
  if (!portions.length) return 'Portion: 100 g';
  return `Portions: ${portions.join(', ')}${candidate.portions.length > 3 ? ', more…' : ''}`;
}

function preferredPortion(candidate: FoodCandidate): FoodPortion | undefined {
  return (
    candidate.portions.find((portion) => portion.isDefault && (portion.gramWeight ?? 0) > 0) ??
    candidate.portions.find((portion) => (portion.gramWeight ?? 0) > 0)
  );
}

function sourceForFood(food: Food): FoodSourceId {
  return sourceIdFromFoodId(food.id) ?? 'personal';
}

export default function LogFoodScreen() {
  const colors = useThemeColors();
  const router = useRouter();
  const [services, setServices] = useState<AppServices | null>(null);
  const [query, setQuery] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [groups, setGroups] = useState<Partial<Record<FoodSourceId, FoodSearchGroup>>>({});
  const [enabledSources, setEnabledSources] = useState<ReadonlySet<FoodSourceId>>(
    () => new Set(foodSources.map((source) => source.id)),
  );
  const [suggestions, setSuggestions] = useState<readonly FoodSuggestion[]>([]);
  const [favoriteIds, setFavoriteIds] = useState<ReadonlySet<FoodId>>(new Set());
  const [selected, setSelected] = useState<FoodCandidate | null>(null);
  const [grams, setGrams] = useState('100');
  const [message, setMessage] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const searchGeneration = useRef(0);
  const searchController = useRef<AbortController | null>(null);
  const actionGate = useRef(new ExclusiveActionGate()).current;

  useEffect(() => {
    let active = true;
    void openAppServices()
      .then(async (nextServices) => {
        if (!active) return;
        setServices(nextServices);
        const now = new Date().toISOString() as ISODateTime;
        const [nextSuggestions, nextFavorites, preferences] = await Promise.all([
          nextServices.suggestions.listSuggestions(now),
          nextServices.favorites.listFavoriteIds(),
          nextServices.preferences.list(),
        ]);
        if (!active) return;
        setSuggestions(nextSuggestions);
        setFavoriteIds(new Set(nextFavorites));
        setEnabledSources(
          new Set(preferences.filter((preference) => preference.enabled).map((preference) => preference.sourceId)),
        );
      })
      .catch((error: unknown) => {
        if (active) setMessage(error instanceof Error ? error.message : 'Unable to prepare food sources.');
      });

    return () => {
      active = false;
      searchGeneration.current += 1;
      searchController.current?.abort();
    };
  }, []);

  async function refreshQuickLog(nextServices = services) {
    if (!nextServices) return;
    const now = new Date().toISOString() as ISODateTime;
    const [nextSuggestions, nextFavorites] = await Promise.all([
      nextServices.suggestions.listSuggestions(now),
      nextServices.favorites.listFavoriteIds(),
    ]);
    setSuggestions(nextSuggestions);
    setFavoriteIds(new Set(nextFavorites));
  }

  async function search() {
    if (!services) return;
    const normalized = query.trim();
    if (normalized.length < 2 || normalized.length > 80) {
      setMessage('Enter a search term between 2 and 80 characters.');
      return;
    }

    const generation = searchGeneration.current + 1;
    searchGeneration.current = generation;
    searchController.current?.abort();
    const controller = new AbortController();
    searchController.current = controller;
    setMessage(null);
    setSelected(null);
    setSubmittedQuery(normalized);

    let enabled = enabledSources;
    const initial: Partial<Record<FoodSourceId, FoodSearchGroup>> = {};
    for (const source of foodSources) {
      if (enabled.has(source.id)) initial[source.id] = { sourceId: source.id, query: normalized, state: 'loading' };
    }
    setGroups(initial);

    try {
      const preferences = await services.preferences.list();
      enabled = new Set(
        preferences.filter((preference) => preference.enabled).map((preference) => preference.sourceId),
      );
      if (generation !== searchGeneration.current) return;
      setEnabledSources(enabled);
      const loading: Partial<Record<FoodSourceId, FoodSearchGroup>> = {};
      for (const source of foodSources) {
        if (enabled.has(source.id)) loading[source.id] = { sourceId: source.id, query: normalized, state: 'loading' };
      }
      setGroups(loading);

      const results = await services.discovery.search(normalized, {
        limit: 12,
        signal: controller.signal,
        onGroup: (result) => {
          if (generation !== searchGeneration.current) return;
          setGroups((current) => ({ ...current, [result.sourceId]: result }));
        },
      });
      if (generation !== searchGeneration.current) return;
      const resolved: Partial<Record<FoodSourceId, FoodSearchGroup>> = {};
      for (const result of results) resolved[result.sourceId] = result;
      for (const source of foodSources) {
        if (enabled.has(source.id) && !resolved[source.id]) {
          resolved[source.id] = {
            sourceId: source.id,
            query: normalized,
            state: 'error',
            candidates: [],
            issue: {
              kind: 'error',
              code: 'source-unavailable',
              message: `${source.name} did not return a search status.`,
            },
          };
        }
      }
      setGroups(resolved);
    } catch (error) {
      if (generation !== searchGeneration.current) return;
      const text = error instanceof Error ? error.message : 'Search could not start.';
      setMessage(text);
      const failed: Partial<Record<FoodSourceId, FoodSearchGroup>> = {};
      for (const source of foodSources) {
        if (!enabled.has(source.id)) continue;
        failed[source.id] = {
          sourceId: source.id,
          query: normalized,
          state: 'error',
          candidates: [],
          issue: { kind: 'error', code: 'search-failed', message: text },
        };
      }
      setGroups(failed);
    }
  }

  function selectCandidate(candidate: FoodCandidate, portion = preferredPortion(candidate)) {
    setSelected(candidate);
    setGrams(String(portion?.gramWeight ?? 100));
    setMessage(null);
  }

  async function candidateForFood(food: Food): Promise<FoodCandidate> {
    if (!services) return candidateFromFood(food, sourceForFood(food));
    try {
      return (await services.discovery.getByFoodId(food.id)) ?? candidateFromFood(food, sourceForFood(food));
    } catch {
      return candidateFromFood(food, sourceForFood(food));
    }
  }

  async function persistAndLog(candidate: FoodCandidate, gramWeight: number) {
    if (!services) return;
    await services.discovery.persist(candidate);
    await services.logging.logFood(
      candidate.food,
      gramWeight,
      new Date().toISOString() as ISODateTime,
    );
  }

  async function runAction(name: string, action: () => Promise<void>) {
    await actionGate.run(async () => {
      setBusyAction(name);
      setMessage(null);
      try {
        await action();
      } finally {
        setBusyAction(null);
      }
    });
  }

  async function logSelected() {
    if (!services || !selected) return;
    const amount = Number(grams);
    if (!Number.isFinite(amount) || amount <= 0) {
      setMessage('Enter a portion greater than zero grams.');
      return;
    }
    await runAction(`log:${selected.food.id}`, async () => {
      try {
        await persistAndLog(selected, amount);
        router.back();
      } catch (error) {
        setMessage(error instanceof Error ? error.message : 'Unable to log food.');
      }
    });
  }

  async function quickLog(suggestion: FoodSuggestion) {
    if (!services) return;
    await runAction(`quick:${suggestion.food.id}`, async () => {
      try {
        const candidate = await candidateForFood(suggestion.food);
        await persistAndLog(candidate, suggestion.suggestedGramWeight);
        router.back();
      } catch (error) {
        setMessage(error instanceof Error ? error.message : 'Unable to log food.');
      }
    });
  }

  async function adjustSuggestion(suggestion: FoodSuggestion) {
    await runAction(`adjust:${suggestion.food.id}`, async () => {
      try {
        const candidate = await candidateForFood(suggestion.food);
        selectCandidate(candidate, {
          id: 'last-portion',
          label: 'Last portion',
          quantity: 1,
          unit: 'g',
          gramWeight: suggestion.suggestedGramWeight,
        });
      } catch (error) {
        setMessage(error instanceof Error ? error.message : 'Unable to load this food.');
      }
    });
  }

  async function toggleFavorite(candidate: FoodCandidate) {
    if (!services) return;
    const favorite = !favoriteIds.has(candidate.food.id);
    await runAction(`favorite:${candidate.food.id}`, async () => {
      try {
        await services.discovery.persist(candidate);
        await services.suggestions.setFavorite(
          candidate.food,
          favorite,
          new Date().toISOString() as ISODateTime,
        );
        await refreshQuickLog(services);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : 'Unable to update favorite.');
      }
    });
  }

  async function toggleSuggestionFavorite(suggestion: FoodSuggestion) {
    const candidate = await candidateForFood(suggestion.food);
    await toggleFavorite(candidate);
  }

  function renderCandidate(candidate: FoodCandidate) {
    const favorite = favoriteIds.has(candidate.food.id);
    const provenance = [
      candidate.provenance.dataset,
      candidate.provenance.release ? `Release ${candidate.provenance.release}` : undefined,
      candidate.provenance.license ? `License: ${candidate.provenance.license.name}` : undefined,
      `Record ${candidate.provenance.recordId}`,
    ].filter((value): value is string => Boolean(value));

    return (
      <Surface key={candidate.food.id} tone={selected?.food.id === candidate.food.id ? 'muted' : 'default'}>
        <Text allowFontScaling selectable style={[typography.bodyStrong, { color: colors.textPrimary }]}>
          {candidate.food.name}
        </Text>
        {candidate.food.brand ? (
          <Text allowFontScaling selectable style={[typography.caption, { color: colors.textSecondary }]}>
            {candidate.food.brand}
          </Text>
        ) : null}
        <Text allowFontScaling selectable style={[typography.caption, { color: colors.textSecondary }]}>
          {candidatePortionSummary(candidate)}
        </Text>
        <Text allowFontScaling selectable style={[typography.caption, { color: colors.textSecondary }]}>
          {provenance.join(' · ')}
        </Text>
        <ActionButton
          label={selected?.food.id === candidate.food.id ? 'Selected' : 'Select food'}
          tone="secondary"
          disabled={busyAction !== null}
          onPress={() => selectCandidate(candidate)}
        />
        <ActionButton
          label={favorite ? 'Remove favorite' : 'Favorite'}
          tone="secondary"
          disabled={busyAction !== null}
          onPress={() => void toggleFavorite(candidate)}
        />
      </Surface>
    );
  }

  function renderProvider(source: (typeof foodSources)[number]) {
    const enabled = enabledSources.has(source.id);
    const group = groups[source.id];
    let content;

    if (!enabled) {
      content = <ScreenState title="Disabled" message="Turn this source on under Me → Food data sources." />;
    } else if (!group || group.state === 'loading') {
      content = <ScreenState title="Searching…" message={`Checking ${source.name}.`} />;
    } else if (group.state === 'empty') {
      content = <ScreenState title="No matches" message={`${source.name} found no matches for “${submittedQuery}.”`} />;
    } else if (group.state === 'ready') {
      content = (
        <View style={{ gap: spacing.sm }}>
          {group.freshness === 'fresh-cache' ? (
            <Text allowFontScaling selectable style={[typography.caption, { color: colors.textSecondary }]}>
              Recently saved results
            </Text>
          ) : null}
          {group.candidates.map(renderCandidate)}
        </View>
      );
    } else {
      const retry = group.issue.retryAt
        ? ` Try again after ${new Date(group.issue.retryAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}.`
        : '';
      const title = group.state === 'offline'
        ? 'Offline'
        : group.state === 'throttled'
          ? 'Temporarily limited'
          : 'Source unavailable';
      content = (
        <View style={{ gap: spacing.sm }}>
          <ScreenState
            title={title}
            message={`${group.issue.message}${retry}${group.candidates.length ? ' Showing saved results.' : ''}`}
            role={group.state === 'error' ? 'alert' : 'status'}
          />
          {group.candidates.map(renderCandidate)}
        </View>
      );
    }

    return (
      <Surface key={source.id}>
        <Text accessibilityRole="header" allowFontScaling selectable style={[typography.title3, { color: colors.textPrimary }]}>
          {source.name}
        </Text>
        <Text allowFontScaling selectable style={[typography.caption, { color: colors.textSecondary }]}>
          {source.detail}
        </Text>
        {content}
      </Surface>
    );
  }

  const selectedPortions = selected?.portions.filter((portion) => (portion.gramWeight ?? 0) > 0) ?? [];

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ padding: spacing.md, gap: spacing.md, backgroundColor: colors.background }}
      keyboardShouldPersistTaps="handled"
    >
      <Text accessibilityRole="header" allowFontScaling selectable style={[typography.title1, { color: colors.textPrimary }]}>
        Log food
      </Text>

      {suggestions.length > 0 ? (
        <View style={{ gap: spacing.sm }}>
          <Text accessibilityRole="header" allowFontScaling selectable style={[typography.title3, { color: colors.textPrimary }]}>
            Quick log
          </Text>
          {suggestions.map((suggestion) => {
            const source = sourceForFood(suggestion.food);
            return (
              <Surface key={suggestion.food.id}>
                <Text allowFontScaling selectable style={[typography.bodyStrong, { color: colors.textPrimary }]}>
                  {suggestion.food.name}
                </Text>
                <Text allowFontScaling selectable style={[typography.caption, { color: colors.textSecondary }]}>
                  {sourceNameById[source]} · {suggestion.favorite ? 'Favorite · ' : ''}
                  {suggestion.logCount > 0
                    ? `${suggestion.logCount} log${suggestion.logCount === 1 ? '' : 's'} · ${Math.round(suggestion.suggestedGramWeight)} g last portion`
                    : 'Saved favorite'}
                </Text>
                <ActionButton
                  label={`Log ${Math.round(suggestion.suggestedGramWeight)} g`}
                  disabled={busyAction !== null}
                  onPress={() => void quickLog(suggestion)}
                />
                <ActionButton
                  label="Adjust portion"
                  tone="secondary"
                  disabled={busyAction !== null}
                  onPress={() => void adjustSuggestion(suggestion)}
                />
                <ActionButton
                  label={suggestion.favorite ? 'Remove favorite' : 'Favorite'}
                  tone="secondary"
                  disabled={busyAction !== null}
                  onPress={() => void toggleSuggestionFavorite(suggestion)}
                />
              </Surface>
            );
          })}
        </View>
      ) : services ? (
        <Text allowFontScaling selectable style={[typography.caption, { color: colors.textSecondary }]}>
          Quick log will learn from foods you log or favorite.
        </Text>
      ) : null}

      <Surface>
        <TextInput
          accessibilityLabel="Search foods"
          accessibilityHint="Enter a term, then press Search. Typing alone does not contact food providers."
          placeholder="Search foods"
          placeholderTextColor={colors.textSecondary}
          value={query}
          onChangeText={setQuery}
          maxLength={80}
          onSubmitEditing={() => void search()}
          returnKeyType="search"
          style={[
            typography.body,
            {
              color: colors.textPrimary,
              borderColor: colors.border,
              borderWidth: 1,
              borderRadius: 12,
              borderCurve: 'continuous',
              padding: 12,
            },
          ]}
        />
        <ActionButton
          label="Search"
          onPress={() => void search()}
          disabled={!services || query.trim().length < 2}
        />
        <Link href="/meals-recipes" asChild>
          <ActionButton label="Saved meals & recipes" tone="secondary" />
        </Link>
        <Link href="/scan-barcode" asChild>
          <ActionButton label="Scan packaged food" tone="secondary" />
        </Link>
        <Link href="/manual-food" asChild>
          <ActionButton label="Create a food manually" tone="secondary" />
        </Link>
      </Surface>

      {message ? (
        <Text accessibilityLiveRegion="polite" selectable style={[typography.body, { color: colors.destructive }]}>
          {message}
        </Text>
      ) : null}
      {!services && !message ? (
        <ScreenState title="Preparing food sources" message="Opening your private food library…" />
      ) : null}

      {submittedQuery ? (
        <View style={{ gap: spacing.md }}>
          <Text accessibilityRole="header" allowFontScaling selectable style={[typography.title2, { color: colors.textPrimary }]}>
            Results for “{submittedQuery}”
          </Text>
          {foodSources.map(renderProvider)}
        </View>
      ) : null}

      {selected ? (
        <Surface tone="muted">
          <Text accessibilityRole="header" allowFontScaling selectable style={[typography.bodyStrong, { color: colors.textPrimary }]}>
            Portion for {selected.food.name}
          </Text>
          <Text allowFontScaling selectable style={[typography.caption, { color: colors.textSecondary }]}>
            {sourceNameById[selected.ref.sourceId]}
          </Text>
          {selectedPortions.length ? (
            <View style={{ gap: spacing.xs }}>
              <Text allowFontScaling selectable style={[typography.caption, { color: colors.textSecondary }]}>
                Suggested portions
              </Text>
              {selectedPortions.slice(0, 6).map((portion) => (
                <ActionButton
                  key={portion.id}
                  label={`Use ${portionText(portion)}`}
                  tone="secondary"
                  disabled={busyAction !== null}
                  onPress={() => setGrams(String(portion.gramWeight))}
                />
              ))}
            </View>
          ) : null}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
            <TextInput
              accessibilityLabel="Portion in grams"
              accessibilityHint="Enter the weight you ate in grams."
              keyboardType="decimal-pad"
              value={grams}
              onChangeText={setGrams}
              style={[
                typography.body,
                {
                  flex: 1,
                  color: colors.textPrimary,
                  borderColor: colors.border,
                  borderWidth: 1,
                  borderRadius: 12,
                  borderCurve: 'continuous',
                  padding: 12,
                },
              ]}
            />
            <Text allowFontScaling selectable style={[typography.body, { color: colors.textSecondary }]}>
              g
            </Text>
          </View>
          <ActionButton
            label={busyAction?.startsWith('log:') ? 'Logging…' : 'Log food'}
            disabled={busyAction !== null}
            onPress={() => void logSelected()}
          />
        </Surface>
      ) : null}
    </ScrollView>
  );
}

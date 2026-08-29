import { Link, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, Text, TextInput, View } from 'react-native';

import type { Food } from '@/domain';
import type { FoodId, ISODateTime } from '@/domain/shared/ids';
import {
  LocalFoodCorpus,
  openMeatDatabase,
  SqliteFavoriteFoodRepository,
  SqliteFoodRepository,
  SqliteMealRepository,
} from '@/data';
import { FoodLoggingService, defaultLocalIdFactory } from '@/services/logging/food-logging';
import { FoodSuggestionsService, type FoodSuggestion } from '@/services/logging/food-suggestions';
import { ActionButton, Surface, spacing, typography, useThemeColors } from '@/ui';

export default function LogFoodScreen() {
  const colors = useThemeColors();
  const router = useRouter();
  const [loggingService, setLoggingService] = useState<FoodLoggingService | null>(null);
  const [suggestionsService, setSuggestionsService] = useState<FoodSuggestionsService | null>(null);
  const [favoriteRepository, setFavoriteRepository] = useState<SqliteFavoriteFoodRepository | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<readonly Food[]>([]);
  const [suggestions, setSuggestions] = useState<readonly FoodSuggestion[]>([]);
  const [favoriteIds, setFavoriteIds] = useState<ReadonlySet<FoodId>>(new Set());
  const [selected, setSelected] = useState<Food | null>(null);
  const [grams, setGrams] = useState('100');
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void openMeatDatabase()
      .then(async (db) => {
        if (!active) return;
        const foodRepository = new SqliteFoodRepository(db);
        const mealRepository = new SqliteMealRepository(db);
        const favorites = new SqliteFavoriteFoodRepository(db);
        const logging = new FoodLoggingService(
          new LocalFoodCorpus(db),
          foodRepository,
          mealRepository,
          defaultLocalIdFactory,
        );
        const quickSuggestions = new FoodSuggestionsService(mealRepository, foodRepository, favorites);
        setLoggingService(logging);
        setSuggestionsService(quickSuggestions);
        setFavoriteRepository(favorites);
        const now = new Date().toISOString() as ISODateTime;
        const [nextSuggestions, nextFavorites] = await Promise.all([
          quickSuggestions.listSuggestions(now),
          favorites.listFavoriteIds(),
        ]);
        if (active) {
          setSuggestions(nextSuggestions);
          setFavoriteIds(new Set(nextFavorites));
        }
      })
      .catch((error: unknown) => {
        if (active) setMessage(error instanceof Error ? error.message : 'Unable to open food database.');
      });
    return () => {
      active = false;
    };
  }, []);

  async function refreshQuickLog() {
    if (!suggestionsService || !favoriteRepository) return;
    const now = new Date().toISOString() as ISODateTime;
    const [nextSuggestions, nextFavorites] = await Promise.all([
      suggestionsService.listSuggestions(now),
      favoriteRepository.listFavoriteIds(),
    ]);
    setSuggestions(nextSuggestions);
    setFavoriteIds(new Set(nextFavorites));
  }

  async function search() {
    if (!loggingService || !query.trim()) return;
    setMessage(null);
    try {
      setResults((await loggingService.search(query)).map((result) => result.food));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Search failed.');
    }
  }

  function selectFood(food: Food, gramWeight?: number) {
    setSelected(food);
    setGrams(
      String(
        gramWeight ??
          food.servings.find((serving) => serving.isDefault)?.gramWeight ??
          food.servings[0]?.gramWeight ??
          100,
      ),
    );
  }

  async function log() {
    if (!loggingService || !selected) return;
    const amount = Number(grams);
    if (!Number.isFinite(amount) || amount <= 0) {
      setMessage('Enter a portion greater than zero grams.');
      return;
    }
    try {
      await loggingService.logFood(selected, amount, new Date().toISOString() as ISODateTime);
      router.back();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to log food.');
    }
  }

  async function quickLog(suggestion: FoodSuggestion) {
    if (!loggingService) return;
    setMessage(null);
    try {
      await loggingService.logFood(
        suggestion.food,
        suggestion.suggestedGramWeight,
        new Date().toISOString() as ISODateTime,
      );
      router.back();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to log food.');
    }
  }

  async function toggleFavorite(food: Food) {
    if (!suggestionsService) return;
    setMessage(null);
    try {
      await suggestionsService.setFavorite(
        food,
        !favoriteIds.has(food.id),
        new Date().toISOString() as ISODateTime,
      );
      await refreshQuickLog();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to update favorite.');
    }
  }

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ padding: spacing.md, gap: spacing.md, backgroundColor: colors.background }}
      keyboardShouldPersistTaps="handled"
    >
      <Text allowFontScaling selectable style={[typography.title1, { color: colors.textPrimary }]}>Log food</Text>

      {suggestions.length > 0 ? (
        <View style={{ gap: spacing.sm }}>
          <Text allowFontScaling style={[typography.title3, { color: colors.textPrimary }]}>Quick log</Text>
          {suggestions.map((suggestion) => (
            <Surface key={suggestion.food.id}>
              <Text allowFontScaling selectable style={[typography.bodyStrong, { color: colors.textPrimary }]}>{suggestion.food.name}</Text>
              <Text allowFontScaling selectable style={[typography.caption, { color: colors.textSecondary }]}>
                {suggestion.favorite ? 'Favorite · ' : ''}
                {suggestion.logCount > 0
                  ? `${suggestion.logCount} log${suggestion.logCount === 1 ? '' : 's'} · ${Math.round(suggestion.suggestedGramWeight)} g last portion`
                  : 'Saved favorite'}
              </Text>
              <ActionButton label={`Log ${Math.round(suggestion.suggestedGramWeight)} g`} onPress={() => void quickLog(suggestion)} />
              <ActionButton label="Adjust portion" tone="secondary" onPress={() => selectFood(suggestion.food, suggestion.suggestedGramWeight)} />
              <ActionButton label={suggestion.favorite ? 'Remove favorite' : 'Favorite'} tone="secondary" onPress={() => void toggleFavorite(suggestion.food)} />
            </Surface>
          ))}
        </View>
      ) : null}

      <Surface>
        <TextInput
          accessibilityLabel="Search foods"
          placeholder="Search foods"
          placeholderTextColor={colors.textSecondary}
          value={query}
          onChangeText={setQuery}
          onSubmitEditing={() => void search()}
          returnKeyType="search"
          style={[typography.body, { color: colors.textPrimary, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 12 }]}
        />
        <ActionButton label="Search" onPress={() => void search()} disabled={!loggingService || !query.trim()} />
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

      {message ? <Text accessibilityLiveRegion="polite" selectable style={[typography.body, { color: colors.destructive }]}>{message}</Text> : null}

      {results.map((food) => (
        <Surface key={food.id} tone={selected?.id === food.id ? 'muted' : 'default'}>
          <Text allowFontScaling selectable style={[typography.bodyStrong, { color: colors.textPrimary }]}>{food.name}</Text>
          {food.brand ? <Text allowFontScaling selectable style={[typography.caption, { color: colors.textSecondary }]}>{food.brand}</Text> : null}
          <ActionButton label={selected?.id === food.id ? 'Selected' : 'Select'} tone="secondary" onPress={() => selectFood(food)} />
          <ActionButton label={favoriteIds.has(food.id) ? 'Remove favorite' : 'Favorite'} tone="secondary" onPress={() => void toggleFavorite(food)} />
        </Surface>
      ))}

      {selected ? (
        <Surface>
          <Text allowFontScaling style={[typography.bodyStrong, { color: colors.textPrimary }]}>Portion for {selected.name}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
            <TextInput
              accessibilityLabel="Portion in grams"
              keyboardType="decimal-pad"
              value={grams}
              onChangeText={setGrams}
              style={[typography.body, { flex: 1, color: colors.textPrimary, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 12 }]}
            />
            <Text style={[typography.body, { color: colors.textSecondary }]}>g</Text>
          </View>
          <ActionButton label="Log food" onPress={() => void log()} />
        </Surface>
      ) : null}
    </ScrollView>
  );
}

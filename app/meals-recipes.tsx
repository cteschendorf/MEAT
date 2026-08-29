import { useEffect, useMemo, useState } from 'react';
import { ScrollView, Text, TextInput, View } from 'react-native';

import type { Food, Recipe, SavedMeal } from '@/domain';
import type { FoodId, ISODateTime, RecipeId, SavedMealId } from '@/domain/shared/ids';
import {
  LocalFoodCorpus,
  openMeatDatabase,
  SqliteFoodRepository,
  SqliteMealRepository,
  SqliteRecipeRepository,
  SqliteSavedMealRepository,
} from '@/data';
import { FoodLoggingService, defaultLocalIdFactory } from '@/services/logging/food-logging';
import {
  RecipeService,
  SavedMealService,
  recipeFoodId,
} from '@/services/meals/saved-meals';
import { ActionButton, Surface, spacing, typography, useThemeColors } from '@/ui';

type Services = {
  foods: SqliteFoodRepository;
  recipes: SqliteRecipeRepository;
  savedMeals: SqliteSavedMealRepository;
  logging: FoodLoggingService;
  recipeService: RecipeService;
  savedMealService: SavedMealService;
};

export default function MealsRecipesScreen() {
  const colors = useThemeColors();
  const [services, setServices] = useState<Services | null>(null);
  const [foods, setFoods] = useState<readonly Food[]>([]);
  const [recipes, setRecipes] = useState<readonly Recipe[]>([]);
  const [savedMeals, setSavedMeals] = useState<readonly SavedMeal[]>([]);
  const [selectedFoodId, setSelectedFoodId] = useState<FoodId | null>(null);
  const [savedMealName, setSavedMealName] = useState('');
  const [savedMealGrams, setSavedMealGrams] = useState('100');
  const [editingSavedMealId, setEditingSavedMealId] = useState<SavedMealId | null>(null);
  const [recipeName, setRecipeName] = useState('');
  const [ingredientGrams, setIngredientGrams] = useState('200');
  const [yieldServings, setYieldServings] = useState('2');
  const [editingRecipeId, setEditingRecipeId] = useState<RecipeId | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const selectableFoods = useMemo(() => foods.filter((food) => food.kind !== 'recipe').slice(0, 30), [foods]);

  useEffect(() => {
    let active = true;
    void openMeatDatabase()
      .then(async (db) => {
        if (!active) return;
        const foodRepository = new SqliteFoodRepository(db);
        const mealRepository = new SqliteMealRepository(db);
        const recipeRepository = new SqliteRecipeRepository(db);
        const savedMealRepository = new SqliteSavedMealRepository(db);
        const next: Services = {
          foods: foodRepository,
          recipes: recipeRepository,
          savedMeals: savedMealRepository,
          logging: new FoodLoggingService(
            new LocalFoodCorpus(db),
            foodRepository,
            mealRepository,
            defaultLocalIdFactory,
          ),
          recipeService: new RecipeService(recipeRepository, foodRepository),
          savedMealService: new SavedMealService(savedMealRepository, mealRepository, defaultLocalIdFactory),
        };
        setServices(next);
        await refresh(next);
      })
      .catch((error: unknown) => {
        if (active) setMessage(error instanceof Error ? error.message : 'Unable to open saved meals and recipes.');
      });
    return () => {
      active = false;
    };
  }, []);

  async function refresh(next = services) {
    if (!next) return;
    const [nextFoods, nextRecipes, nextSavedMeals] = await Promise.all([
      next.foods.list(200),
      next.recipes.list(),
      next.savedMeals.list(),
    ]);
    setFoods(nextFoods);
    setRecipes(nextRecipes);
    setSavedMeals(nextSavedMeals);
    if (!selectedFoodId) {
      const first = nextFoods.find((food) => food.kind !== 'recipe');
      if (first) setSelectedFoodId(first.id);
    }
  }

  async function saveSavedMeal() {
    if (!services || !selectedFoodId) return;
    const grams = Number(savedMealGrams);
    if (!(grams > 0)) {
      setMessage('Saved meal portion must be greater than zero grams.');
      return;
    }
    const now = new Date().toISOString() as ISODateTime;
    const existing = editingSavedMealId ? await services.savedMeals.getById(editingSavedMealId) : null;
    const value: SavedMeal = {
      id: existing?.id ?? (defaultLocalIdFactory('saved-meal') as SavedMealId),
      name: savedMealName.trim(),
      items: [{ foodId: selectedFoodId, portion: { quantity: 1, gramWeight: grams } }],
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    try {
      await services.savedMealService.save(value);
      setSavedMealName('');
      setEditingSavedMealId(null);
      setMessage('Saved meal updated.');
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to save meal.');
    }
  }

  async function saveRecipe() {
    if (!services || !selectedFoodId) return;
    const grams = Number(ingredientGrams);
    const servings = Number(yieldServings);
    if (!(grams > 0) || !(servings > 0)) {
      setMessage('Ingredient grams and recipe servings must be greater than zero.');
      return;
    }
    const now = new Date().toISOString() as ISODateTime;
    const existing = editingRecipeId ? await services.recipes.getById(editingRecipeId) : null;
    const value: Recipe = {
      id: existing?.id ?? (defaultLocalIdFactory('recipe') as RecipeId),
      name: recipeName.trim(),
      ingredients: [{ foodId: selectedFoodId, quantity: 1, gramWeight: grams }],
      yieldServings: servings,
      totalYieldGrams: grams,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    try {
      await services.recipeService.save(value);
      setRecipeName('');
      setEditingRecipeId(null);
      setMessage('Recipe updated and available for logging.');
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to save recipe.');
    }
  }

  async function logSavedMeal(savedMeal: SavedMeal) {
    if (!services) return;
    await services.savedMealService.log(savedMeal, new Date().toISOString() as ISODateTime);
    setMessage(`${savedMeal.name} logged.`);
  }

  async function duplicateSavedMeal(savedMeal: SavedMeal) {
    if (!services) return;
    const duplicate = services.savedMealService.duplicate(savedMeal, new Date().toISOString() as ISODateTime);
    await services.savedMealService.save(duplicate);
    await refresh();
    setMessage(`${duplicate.name} created.`);
  }

  async function logRecipe(recipe: Recipe) {
    if (!services) return;
    const food = await services.foods.getById(recipeFoodId(recipe.id));
    const grams = food?.servings[0]?.gramWeight;
    if (!food || !grams) {
      setMessage('Recipe food is unavailable. Save the recipe again to rebuild it.');
      return;
    }
    await services.logging.logFood(food, grams, new Date().toISOString() as ISODateTime);
    setMessage(`${recipe.name} logged.`);
  }

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: spacing.md, gap: spacing.md, backgroundColor: colors.background }}
    >
      <Text allowFontScaling selectable style={[typography.title1, { color: colors.textPrimary }]}>Saved meals & recipes</Text>
      <Text allowFontScaling selectable style={[typography.body, { color: colors.textSecondary }]}>Build reusable logs from foods already saved on this device. Recipe nutrition is recalculated deterministically whenever the recipe changes.</Text>

      {message ? <Text accessibilityLiveRegion="polite" style={[typography.body, { color: colors.textSecondary }]}>{message}</Text> : null}

      <Surface>
        <Text allowFontScaling style={[typography.title3, { color: colors.textPrimary }]}>Choose a food</Text>
        {selectableFoods.length === 0 ? (
          <Text style={[typography.body, { color: colors.textSecondary }]}>Log or create a food first.</Text>
        ) : (
          <View style={{ gap: spacing.sm }}>
            {selectableFoods.map((food) => (
              <ActionButton
                key={food.id}
                label={selectedFoodId === food.id ? `Selected: ${food.name}` : food.name}
                tone="secondary"
                onPress={() => setSelectedFoodId(food.id)}
              />
            ))}
          </View>
        )}
      </Surface>

      <Surface>
        <Text allowFontScaling style={[typography.title3, { color: colors.textPrimary }]}>Saved meal</Text>
        <TextInput accessibilityLabel="Saved meal name" placeholder="Meal name" placeholderTextColor={colors.textSecondary} value={savedMealName} onChangeText={setSavedMealName} style={[typography.body, { color: colors.textPrimary, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 12 }]} />
        <TextInput accessibilityLabel="Saved meal grams" keyboardType="decimal-pad" placeholder="Grams" placeholderTextColor={colors.textSecondary} value={savedMealGrams} onChangeText={setSavedMealGrams} style={[typography.body, { color: colors.textPrimary, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 12 }]} />
        <ActionButton label={editingSavedMealId ? 'Update saved meal' : 'Create saved meal'} onPress={() => void saveSavedMeal()} disabled={!services || !selectedFoodId || !savedMealName.trim()} />
      </Surface>

      {savedMeals.map((savedMeal) => (
        <Surface key={savedMeal.id}>
          <Text allowFontScaling selectable style={[typography.bodyStrong, { color: colors.textPrimary }]}>{savedMeal.name}</Text>
          <ActionButton label="Log" onPress={() => void logSavedMeal(savedMeal)} />
          <ActionButton label="Duplicate" tone="secondary" onPress={() => void duplicateSavedMeal(savedMeal)} />
          <ActionButton label="Edit" tone="secondary" onPress={() => {
            setEditingSavedMealId(savedMeal.id);
            setSavedMealName(savedMeal.name);
            const item = savedMeal.items[0];
            if (item) {
              setSelectedFoodId(item.foodId);
              if (item.portion.gramWeight) setSavedMealGrams(String(item.portion.gramWeight));
            }
          }} />
          <ActionButton label="Delete" tone="secondary" onPress={() => void services?.savedMealService.delete(savedMeal.id).then(() => refresh())} />
        </Surface>
      ))}

      <Surface>
        <Text allowFontScaling style={[typography.title3, { color: colors.textPrimary }]}>Recipe</Text>
        <TextInput accessibilityLabel="Recipe name" placeholder="Recipe name" placeholderTextColor={colors.textSecondary} value={recipeName} onChangeText={setRecipeName} style={[typography.body, { color: colors.textPrimary, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 12 }]} />
        <TextInput accessibilityLabel="Ingredient grams" keyboardType="decimal-pad" placeholder="Ingredient grams" placeholderTextColor={colors.textSecondary} value={ingredientGrams} onChangeText={setIngredientGrams} style={[typography.body, { color: colors.textPrimary, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 12 }]} />
        <TextInput accessibilityLabel="Recipe servings" keyboardType="decimal-pad" placeholder="Yield servings" placeholderTextColor={colors.textSecondary} value={yieldServings} onChangeText={setYieldServings} style={[typography.body, { color: colors.textPrimary, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 12 }]} />
        <ActionButton label={editingRecipeId ? 'Update recipe' : 'Create recipe'} onPress={() => void saveRecipe()} disabled={!services || !selectedFoodId || !recipeName.trim()} />
      </Surface>

      {recipes.map((recipe) => (
        <Surface key={recipe.id}>
          <Text allowFontScaling selectable style={[typography.bodyStrong, { color: colors.textPrimary }]}>{recipe.name}</Text>
          <Text allowFontScaling style={[typography.caption, { color: colors.textSecondary }]}>{recipe.yieldServings} serving{recipe.yieldServings === 1 ? '' : 's'}</Text>
          <ActionButton label="Log 1 serving" onPress={() => void logRecipe(recipe)} />
          <ActionButton label="Edit" tone="secondary" onPress={() => {
            setEditingRecipeId(recipe.id);
            setRecipeName(recipe.name);
            setYieldServings(String(recipe.yieldServings));
            const ingredient = recipe.ingredients[0];
            if (ingredient) {
              setSelectedFoodId(ingredient.foodId);
              if (ingredient.gramWeight) setIngredientGrams(String(ingredient.gramWeight));
            }
          }} />
          <ActionButton label="Delete" tone="secondary" onPress={() => void services?.recipeService.delete(recipe.id).then(() => refresh())} />
        </Surface>
      ))}
    </ScrollView>
  );
}

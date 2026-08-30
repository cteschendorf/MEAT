import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, Text, TextInput, View } from 'react-native';

import type { Food, FoodRef, Recipe, SavedMeal, SavedMealItem } from '@/domain';
import type {
  FoodId,
  FoodServingId,
  ISODateTime,
  RecipeId,
  SavedMealId,
} from '@/domain/shared/ids';
import { openAppServices, type AppServices } from '@/services/app-services';
import { ExclusiveActionGate } from '@/services/actions/exclusive-action';
import { defaultLocalIdFactory } from '@/services/logging/food-logging';
import {
  foodRefForFoodId,
  recipeServingGrams,
  resolvedFoodId,
} from '@/services/meals/saved-meals';
import { ActionButton, Surface, spacing, typography, useThemeColors } from '@/ui';
import {
  addRecipeSnapshotToComposer,
  prefillSavedMealComposer,
} from '@/ui/meal-composer-entry';
import { useMutationRouteGuard } from '@/ui/navigation/use-mutation-route-guard';

interface SavedMealDraftItem {
  key: string;
  foodId: FoodId;
  foodRef: FoodRef;
  foodName: string;
  quantity: string;
  gramWeight: string;
  servingId?: FoodServingId;
}

interface RecipeDraftIngredient {
  key: string;
  foodId: FoodId;
  foodRef: FoodRef;
  foodName: string;
  quantity: string;
  gramWeight: string;
}

function positiveNumber(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${label} must be greater than zero.`);
  return parsed;
}

function sourceLabel(ref: FoodRef): string {
  switch (ref.sourceId) {
    case 'personal':
      return 'Personal';
    case 'usda-core':
      return 'USDA on device';
    case 'usda-fdc':
      return 'USDA online';
    case 'open-food-facts':
      return 'Open Food Facts';
  }
}

export default function MealsRecipesScreen() {
  const colors = useThemeColors();
  const router = useRouter();
  const params = useLocalSearchParams<{ draftId?: string }>();
  const draftId = typeof params.draftId === 'string' ? params.draftId : undefined;
  const [services, setServices] = useState<AppServices | null>(null);
  const [foods, setFoods] = useState<readonly Food[]>([]);
  const [recipes, setRecipes] = useState<readonly Recipe[]>([]);
  const [savedMeals, setSavedMeals] = useState<readonly SavedMeal[]>([]);
  const [selectedFoodId, setSelectedFoodId] = useState<FoodId | null>(null);

  const [savedMealName, setSavedMealName] = useState('');
  const [savedMealQuantity, setSavedMealQuantity] = useState('1');
  const [savedMealGrams, setSavedMealGrams] = useState('100');
  const [savedMealItems, setSavedMealItems] = useState<readonly SavedMealDraftItem[]>([]);
  const [editingSavedMealId, setEditingSavedMealId] = useState<SavedMealId | null>(null);

  const [recipeName, setRecipeName] = useState('');
  const [ingredientQuantity, setIngredientQuantity] = useState('1');
  const [ingredientGrams, setIngredientGrams] = useState('200');
  const [recipeIngredients, setRecipeIngredients] = useState<readonly RecipeDraftIngredient[]>([]);
  const [yieldServings, setYieldServings] = useState('2');
  const [totalYieldGrams, setTotalYieldGrams] = useState('');
  const [editingRecipeId, setEditingRecipeId] = useState<RecipeId | null>(null);
  const [recipeLogServings, setRecipeLogServings] = useState<Readonly<Record<string, string>>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const actionGate = useRef(new ExclusiveActionGate()).current;
  const busy = busyAction !== null;
  const queueRouteExit = useMutationRouteGuard(
    busy,
    'Please wait while the saved meal or recipe action finishes.',
  );

  const selectableFoods = useMemo(
    () => foods.filter((food) => food.kind !== 'recipe').slice(0, 40),
    [foods],
  );
  const selectedFood = useMemo(
    () => selectableFoods.find((food) => food.id === selectedFoodId) ?? null,
    [selectableFoods, selectedFoodId],
  );

  useEffect(() => {
    let active = true;
    void openAppServices()
      .then(async (next) => {
        const [nextFoods, nextRecipes, nextSavedMeals] = await Promise.all([
          next.foods.list(200),
          next.recipeService.list(),
          next.savedMealService.list(),
        ]);
        if (!active) return;
        setServices(next);
        setFoods(nextFoods);
        setRecipes(nextRecipes);
        setSavedMeals(nextSavedMeals);
        setSelectedFoodId(nextFoods.find((food) => food.kind !== 'recipe')?.id ?? null);
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
      next.recipeService.list(),
      next.savedMealService.list(),
    ]);
    setFoods(nextFoods);
    setRecipes(nextRecipes);
    setSavedMeals(nextSavedMeals);
    setSelectedFoodId((current) => {
      if (current && nextFoods.some((food) => food.id === current && food.kind !== 'recipe')) return current;
      return nextFoods.find((food) => food.kind !== 'recipe')?.id ?? null;
    });
  }

  async function runMutation(name: string, action: () => Promise<void>) {
    await actionGate.run(async () => {
      setBusyAction(name);
      try {
        await action();
      } finally {
        setBusyAction(null);
      }
    });
  }

  function nameForFoodId(foodId: FoodId): string {
    return foods.find((food) => food.id === foodId)?.name ?? String(foodId);
  }

  function resetSavedMealEditor() {
    setEditingSavedMealId(null);
    setSavedMealName('');
    setSavedMealItems([]);
    setSavedMealQuantity('1');
    setSavedMealGrams('100');
  }

  function resetRecipeEditor() {
    setEditingRecipeId(null);
    setRecipeName('');
    setRecipeIngredients([]);
    setIngredientQuantity('1');
    setIngredientGrams('200');
    setYieldServings('2');
    setTotalYieldGrams('');
  }

  function addSavedMealItem() {
    if (actionGate.isActive) return;
    if (!selectedFood) {
      setMessage('Choose a food before adding an item.');
      return;
    }
    try {
      positiveNumber(savedMealQuantity, 'Saved meal item quantity');
      positiveNumber(savedMealGrams, 'Saved meal item grams');
      setSavedMealItems((current) => [
        ...current,
        {
          key: defaultLocalIdFactory('saved-meal-draft-item'),
          foodId: selectedFood.id,
          foodRef: foodRefForFoodId(selectedFood.id),
          foodName: selectedFood.name,
          quantity: savedMealQuantity,
          gramWeight: savedMealGrams,
        },
      ]);
      setMessage(`${selectedFood.name} added to the saved meal.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to add the saved-meal item.');
    }
  }

  async function saveSavedMeal() {
    if (!services) return;
    await runMutation('saving-saved-meal', async () => {
      try {
        if (savedMealItems.length === 0) throw new Error('Add at least one food to the saved meal.');
        const now = new Date().toISOString() as ISODateTime;
        const existing = editingSavedMealId
          ? await services.savedMealService.getById(editingSavedMealId)
          : null;
        const items: SavedMealItem[] = savedMealItems.map((item) => {
          const quantity = positiveNumber(item.quantity, `${item.foodName} quantity`);
          const gramWeight = item.gramWeight.trim()
            ? positiveNumber(item.gramWeight, `${item.foodName} grams`)
            : undefined;
          if (gramWeight === undefined && !item.servingId) {
            throw new Error(`${item.foodName} needs grams or a saved serving.`);
          }
          return {
            foodId: item.foodId,
            foodRef: { ...item.foodRef },
            portion: {
              quantity,
              ...(gramWeight === undefined ? {} : { gramWeight }),
              ...(item.servingId ? { servingId: item.servingId } : {}),
            },
          };
        });
        const savedMeal: SavedMeal = {
          id: existing?.id ?? (defaultLocalIdFactory('saved-meal') as SavedMealId),
          name: savedMealName.trim(),
          items,
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
        };
        await services.savedMealService.save(savedMeal);
        resetSavedMealEditor();
        await refresh();
        setMessage(existing ? 'Saved meal updated.' : 'Saved meal created.');
      } catch (error) {
        setMessage(error instanceof Error ? error.message : 'Unable to save meal.');
      }
    });
  }

  async function addSavedMeal(savedMeal: SavedMeal) {
    if (!services) return;
    await runMutation(`adding-saved-meal:${savedMeal.id}`, async () => {
      try {
        const result = await prefillSavedMealComposer(
          services,
          draftId,
          savedMeal,
          new Date().toISOString() as ISODateTime,
        );
        queueRouteExit(() => router.dismissTo({
          pathname: '/log-food',
          params: { draftId: result.session.draft.id },
        }));
      } catch (error) {
        setMessage(error instanceof Error ? error.message : 'Unable to add the saved meal.');
      }
    });
  }

  async function duplicateSavedMeal(savedMeal: SavedMeal) {
    if (!services) return;
    await runMutation(`duplicating-saved-meal:${savedMeal.id}`, async () => {
      try {
        const duplicate = services.savedMealService.duplicate(
          savedMeal,
          new Date().toISOString() as ISODateTime,
        );
        await services.savedMealService.save(duplicate);
        await refresh();
        setMessage(`${duplicate.name} created.`);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : 'Unable to duplicate the saved meal.');
      }
    });
  }

  function editSavedMeal(savedMeal: SavedMeal) {
    if (actionGate.isActive) return;
    setEditingSavedMealId(savedMeal.id);
    setSavedMealName(savedMeal.name);
    setSavedMealItems(
      savedMeal.items.map((item) => {
        const resolvedId = resolvedFoodId(item);
        return {
          key: defaultLocalIdFactory('saved-meal-draft-item'),
          foodId: item.foodId,
          foodRef: item.foodRef ? { ...item.foodRef } : foodRefForFoodId(item.foodId),
          foodName: nameForFoodId(resolvedId),
          quantity: String(item.portion.quantity),
          gramWeight: item.portion.gramWeight === undefined ? '' : String(item.portion.gramWeight),
          ...(item.portion.servingId ? { servingId: item.portion.servingId } : {}),
        };
      }),
    );
    const first = savedMeal.items[0];
    if (first) setSelectedFoodId(resolvedFoodId(first));
  }

  async function deleteSavedMeal(savedMeal: SavedMeal) {
    if (!services) return;
    await runMutation(`deleting-saved-meal:${savedMeal.id}`, async () => {
      try {
        await services.savedMealService.delete(savedMeal.id);
        if (editingSavedMealId === savedMeal.id) resetSavedMealEditor();
        await refresh();
        setMessage(`${savedMeal.name} deleted.`);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : 'Unable to delete the saved meal.');
      }
    });
  }

  function addRecipeIngredient() {
    if (actionGate.isActive) return;
    if (!selectedFood) {
      setMessage('Choose a food before adding an ingredient.');
      return;
    }
    try {
      positiveNumber(ingredientQuantity, 'Ingredient quantity');
      positiveNumber(ingredientGrams, 'Ingredient grams');
      setRecipeIngredients((current) => [
        ...current,
        {
          key: defaultLocalIdFactory('recipe-draft-ingredient'),
          foodId: selectedFood.id,
          foodRef: foodRefForFoodId(selectedFood.id),
          foodName: selectedFood.name,
          quantity: ingredientQuantity,
          gramWeight: ingredientGrams,
        },
      ]);
      setMessage(`${selectedFood.name} added to the recipe.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to add the recipe ingredient.');
    }
  }

  async function saveRecipe() {
    if (!services) return;
    await runMutation('saving-recipe', async () => {
      try {
      if (recipeIngredients.length === 0) throw new Error('Add at least one ingredient to the recipe.');
      const servings = positiveNumber(yieldServings, 'Recipe yield servings');
      const ingredients = recipeIngredients.map((ingredient) => ({
        foodId: ingredient.foodId,
        foodRef: { ...ingredient.foodRef },
        quantity: positiveNumber(ingredient.quantity, `${ingredient.foodName} quantity`),
        gramWeight: positiveNumber(ingredient.gramWeight, `${ingredient.foodName} grams`),
      }));
      const derivedYield = ingredients.reduce((sum, ingredient) => sum + ingredient.gramWeight, 0);
      const yieldGrams = totalYieldGrams.trim()
        ? positiveNumber(totalYieldGrams, 'Recipe total yield grams')
        : derivedYield;
      const now = new Date().toISOString() as ISODateTime;
      const existing = editingRecipeId ? await services.recipeService.getById(editingRecipeId) : null;
      const recipe: Recipe = {
        id: existing?.id ?? (defaultLocalIdFactory('recipe') as RecipeId),
        name: recipeName.trim(),
        ingredients,
        yieldServings: servings,
        totalYieldGrams: yieldGrams,
        ...(existing?.instructions ? { instructions: existing.instructions } : {}),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      await services.recipeService.save(recipe);
      resetRecipeEditor();
      await refresh();
      setMessage(existing ? 'Recipe updated and recalculated.' : 'Recipe created and ready to log.');
      } catch (error) {
        setMessage(error instanceof Error ? error.message : 'Unable to save recipe.');
      }
    });
  }

  async function duplicateRecipe(recipe: Recipe) {
    if (!services) return;
    await runMutation(`duplicating-recipe:${recipe.id}`, async () => {
      try {
        const duplicate = services.recipeService.duplicate(
          recipe,
          new Date().toISOString() as ISODateTime,
        );
        await services.recipeService.save(duplicate);
        await refresh();
        setMessage(`${duplicate.name} created.`);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : 'Unable to duplicate the recipe.');
      }
    });
  }

  function editRecipe(recipe: Recipe) {
    if (actionGate.isActive) return;
    setEditingRecipeId(recipe.id);
    setRecipeName(recipe.name);
    setYieldServings(String(recipe.yieldServings));
    setTotalYieldGrams(recipe.totalYieldGrams === undefined ? '' : String(recipe.totalYieldGrams));
    setRecipeIngredients(
      recipe.ingredients.map((ingredient) => {
        const resolvedId = resolvedFoodId(ingredient);
        return {
          key: defaultLocalIdFactory('recipe-draft-ingredient'),
          foodId: ingredient.foodId,
          foodRef: ingredient.foodRef ? { ...ingredient.foodRef } : foodRefForFoodId(ingredient.foodId),
          foodName: nameForFoodId(resolvedId),
          quantity: String(ingredient.quantity),
          gramWeight: ingredient.gramWeight === undefined ? '' : String(ingredient.gramWeight),
        };
      }),
    );
    const first = recipe.ingredients[0];
    if (first) setSelectedFoodId(resolvedFoodId(first));
  }

  async function deleteRecipe(recipe: Recipe) {
    if (!services) return;
    await runMutation(`deleting-recipe:${recipe.id}`, async () => {
      try {
        await services.recipeService.delete(recipe.id);
        if (editingRecipeId === recipe.id) resetRecipeEditor();
        await refresh();
        setMessage(`${recipe.name} deleted. Earlier logged nutrition was kept.`);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : 'Unable to delete the recipe.');
      }
    });
  }

  async function addRecipe(recipe: Recipe) {
    if (!services) return;
    await runMutation(`adding-recipe:${recipe.id}`, async () => {
      try {
        const servings = positiveNumber(
          recipeLogServings[recipe.id] ?? '1',
          'Recipe servings to add',
        );
        const result = await addRecipeSnapshotToComposer(
          services,
          draftId,
          recipe,
          servings,
          new Date().toISOString() as ISODateTime,
        );
        queueRouteExit(() => router.dismissTo({
          pathname: '/log-food',
          params: { draftId: result.session.draft.id },
        }));
      } catch (error) {
        setMessage(error instanceof Error ? error.message : 'Unable to add the recipe.');
      }
    });
  }

  const inputStyle = [
    typography.body,
    {
      color: colors.textPrimary,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: 12,
      padding: 12,
    },
  ];

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: spacing.md, gap: spacing.md, backgroundColor: colors.background }}
    >
      <Text allowFontScaling selectable style={[typography.title1, { color: colors.textPrimary }]}>Saved meals & recipes</Text>
      <Text allowFontScaling selectable style={[typography.body, { color: colors.textSecondary }]}>Combine personal and provider foods into reusable meals and recipes. Add a saved meal or any fractional recipe serving to the event you are composing, then confirm everything once.</Text>

      {busyAction ? <Text accessibilityLiveRegion="polite" style={[typography.body, { color: colors.textSecondary }]}>Working. Please wait…</Text> : null}
      {message ? <Text accessibilityLiveRegion="polite" style={[typography.body, { color: colors.textSecondary }]}>{message}</Text> : null}

      <Surface>
        <Text allowFontScaling style={[typography.title3, { color: colors.textPrimary }]}>Choose a food</Text>
        {selectableFoods.length === 0 ? (
          <Text style={[typography.body, { color: colors.textSecondary }]}>Log or create a food first.</Text>
        ) : (
          <View style={{ gap: spacing.sm }}>
            {selectableFoods.map((food) => {
              const ref = foodRefForFoodId(food.id);
              return (
                <ActionButton
                  key={food.id}
                  label={`${selectedFoodId === food.id ? 'Selected: ' : ''}${food.name} · ${sourceLabel(ref)}`}
                  tone="secondary"
                  onPress={() => setSelectedFoodId(food.id)}
                  disabled={busy}
                />
              );
            })}
          </View>
        )}
      </Surface>

      <Surface>
        <Text allowFontScaling style={[typography.title3, { color: colors.textPrimary }]}>Saved meal</Text>
        <TextInput accessibilityLabel="Saved meal name" placeholder="Meal name" placeholderTextColor={colors.textSecondary} value={savedMealName} onChangeText={setSavedMealName} style={inputStyle} />
        <TextInput accessibilityLabel="Saved meal item quantity" keyboardType="decimal-pad" placeholder="Quantity" placeholderTextColor={colors.textSecondary} value={savedMealQuantity} onChangeText={setSavedMealQuantity} style={inputStyle} />
        <TextInput accessibilityLabel="Saved meal item grams" keyboardType="decimal-pad" placeholder="Total grams" placeholderTextColor={colors.textSecondary} value={savedMealGrams} onChangeText={setSavedMealGrams} style={inputStyle} />
        <ActionButton label="Add selected food" tone="secondary" onPress={addSavedMealItem} disabled={busy || !services || !selectedFood} />
        {savedMealItems.map((item) => (
          <View key={item.key} style={{ gap: spacing.xs }}>
            <Text allowFontScaling style={[typography.body, { color: colors.textPrimary }]}>{item.foodName} · quantity {item.quantity} · {item.gramWeight ? `${item.gramWeight} g total` : 'saved serving'} · {sourceLabel(item.foodRef)}</Text>
            <ActionButton label={`Remove ${item.foodName}`} tone="secondary" onPress={() => setSavedMealItems((current) => current.filter((candidate) => candidate.key !== item.key))} disabled={busy} />
          </View>
        ))}
        <ActionButton label={editingSavedMealId ? 'Update saved meal' : 'Create saved meal'} onPress={() => void saveSavedMeal()} disabled={busy || !services || !savedMealName.trim() || savedMealItems.length === 0} />
        {editingSavedMealId ? <ActionButton label="Cancel saved meal edit" tone="secondary" onPress={resetSavedMealEditor} disabled={busy} /> : null}
      </Surface>

      {savedMeals.map((savedMeal) => (
        <Surface key={savedMeal.id}>
          <Text allowFontScaling selectable style={[typography.bodyStrong, { color: colors.textPrimary }]}>{savedMeal.name}</Text>
          <Text allowFontScaling style={[typography.caption, { color: colors.textSecondary }]}>{savedMeal.items.length} item{savedMeal.items.length === 1 ? '' : 's'}</Text>
          {savedMeal.items.map((item, index) => (
            <Text key={`${item.foodId}:${index}`} allowFontScaling style={[typography.caption, { color: colors.textSecondary }]}>{nameForFoodId(resolvedFoodId(item))} · {item.portion.gramWeight === undefined ? 'saved serving' : `${item.portion.gramWeight} g`}</Text>
          ))}
          <ActionButton label="Add all items to event" onPress={() => void addSavedMeal(savedMeal)} disabled={busy} />
          <ActionButton label="Duplicate" tone="secondary" onPress={() => void duplicateSavedMeal(savedMeal)} disabled={busy} />
          <ActionButton label="Edit" tone="secondary" onPress={() => editSavedMeal(savedMeal)} disabled={busy} />
          <ActionButton label="Delete" tone="secondary" onPress={() => void deleteSavedMeal(savedMeal)} disabled={busy} />
        </Surface>
      ))}

      <Surface>
        <Text allowFontScaling style={[typography.title3, { color: colors.textPrimary }]}>Recipe</Text>
        <Text allowFontScaling style={[typography.caption, { color: colors.textSecondary }]}>Each saved edit creates a new nutrition snapshot. Earlier logs keep the nutrition that was current when they were logged, even if you later edit or delete the recipe.</Text>
        <TextInput accessibilityLabel="Recipe name" placeholder="Recipe name" placeholderTextColor={colors.textSecondary} value={recipeName} onChangeText={setRecipeName} style={inputStyle} />
        <TextInput accessibilityLabel="Ingredient quantity" keyboardType="decimal-pad" placeholder="Ingredient quantity" placeholderTextColor={colors.textSecondary} value={ingredientQuantity} onChangeText={setIngredientQuantity} style={inputStyle} />
        <TextInput accessibilityLabel="Ingredient grams" keyboardType="decimal-pad" placeholder="Total ingredient grams" placeholderTextColor={colors.textSecondary} value={ingredientGrams} onChangeText={setIngredientGrams} style={inputStyle} />
        <ActionButton label="Add selected ingredient" tone="secondary" onPress={addRecipeIngredient} disabled={busy || !services || !selectedFood} />
        {recipeIngredients.map((ingredient) => (
          <View key={ingredient.key} style={{ gap: spacing.xs }}>
            <Text allowFontScaling style={[typography.body, { color: colors.textPrimary }]}>{ingredient.foodName} · quantity {ingredient.quantity} · {ingredient.gramWeight} g · {sourceLabel(ingredient.foodRef)}</Text>
            <ActionButton label={`Remove ${ingredient.foodName}`} tone="secondary" onPress={() => setRecipeIngredients((current) => current.filter((candidate) => candidate.key !== ingredient.key))} disabled={busy} />
          </View>
        ))}
        <TextInput accessibilityLabel="Recipe servings" keyboardType="decimal-pad" placeholder="Yield servings" placeholderTextColor={colors.textSecondary} value={yieldServings} onChangeText={setYieldServings} style={inputStyle} />
        <TextInput accessibilityLabel="Recipe total yield grams" keyboardType="decimal-pad" placeholder="Cooked yield grams (optional)" placeholderTextColor={colors.textSecondary} value={totalYieldGrams} onChangeText={setTotalYieldGrams} style={inputStyle} />
        <ActionButton label={editingRecipeId ? 'Update recipe' : 'Create recipe'} onPress={() => void saveRecipe()} disabled={busy || !services || !recipeName.trim() || recipeIngredients.length === 0} />
        {editingRecipeId ? <ActionButton label="Cancel recipe edit" tone="secondary" onPress={resetRecipeEditor} disabled={busy} /> : null}
      </Surface>

      {recipes.map((recipe) => {
        const servingGrams = (() => {
          try {
            return recipeServingGrams(recipe);
          } catch {
            return null;
          }
        })();
        return (
          <Surface key={recipe.id}>
            <Text allowFontScaling selectable style={[typography.bodyStrong, { color: colors.textPrimary }]}>{recipe.name}</Text>
            <Text allowFontScaling style={[typography.caption, { color: colors.textSecondary }]}>{recipe.ingredients.length} ingredient{recipe.ingredients.length === 1 ? '' : 's'} · {recipe.yieldServings} serving{recipe.yieldServings === 1 ? '' : 's'}{servingGrams === null ? '' : ` · ${servingGrams} g each`}</Text>
            <TextInput accessibilityLabel={`${recipe.name} servings to add`} keyboardType="decimal-pad" placeholder="Servings to add, such as 0.5" placeholderTextColor={colors.textSecondary} value={recipeLogServings[recipe.id] ?? '1'} onChangeText={(value) => setRecipeLogServings((current) => ({ ...current, [recipe.id]: value }))} style={inputStyle} />
            <ActionButton label="Add servings to event" onPress={() => void addRecipe(recipe)} disabled={busy} />
            <ActionButton label="Duplicate" tone="secondary" onPress={() => void duplicateRecipe(recipe)} disabled={busy} />
            <ActionButton label="Edit" tone="secondary" onPress={() => editRecipe(recipe)} disabled={busy} />
            <ActionButton label="Delete" tone="secondary" onPress={() => void deleteRecipe(recipe)} disabled={busy} />
          </Surface>
        );
      })}
    </ScrollView>
  );
}

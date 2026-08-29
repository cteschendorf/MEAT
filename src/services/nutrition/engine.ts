import type {
  Food,
  Meal,
  NutrientDefinition,
  NutrientValue,
  NutritionFacts,
  Recipe,
} from '@/domain';

const GRAMS_PER_OUNCE = 28.349523125;

export function ouncesToGrams(ounces: number): number {
  return ounces * GRAMS_PER_OUNCE;
}

export function gramsToOunces(grams: number): number {
  return grams / GRAMS_PER_OUNCE;
}

export function gramsForFoodPortion(
  food: Food,
  portion: { servingId?: string; quantity: number; gramWeight?: number },
): number {
  if (portion.quantity < 0) throw new Error('Portion quantity cannot be negative.');
  if (portion.gramWeight !== undefined) return portion.gramWeight;

  if (!portion.servingId) {
    throw new Error(`No gram weight or serving supplied for ${food.name}.`);
  }

  const serving = food.servings.find((candidate) => candidate.id === portion.servingId);
  if (!serving?.gramWeight) {
    throw new Error(`Serving ${portion.servingId} has no gram weight.`);
  }

  return serving.gramWeight * portion.quantity;
}

export function scaleNutritionFacts(facts: NutritionFacts, targetGrams: number): NutritionFacts {
  if (targetGrams < 0) throw new Error('Target grams cannot be negative.');
  if (!facts.basisGrams || facts.basisGrams <= 0) {
    throw new Error('Nutrition facts require a positive gram basis for scaling.');
  }

  const scale = targetGrams / facts.basisGrams;
  return {
    basisGrams: targetGrams,
    nutrients: facts.nutrients.map((entry) => {
      if (entry.state === 'unknown' || entry.value === undefined) {
        return { nutrient: entry.nutrient, state: 'unknown' } satisfies NutrientValue;
      }

      return {
        nutrient: entry.nutrient,
        state: entry.state,
        value: entry.value * scale,
        ...(entry.source ? { source: entry.source } : {}),
        ...(entry.confidence !== undefined ? { confidence: entry.confidence } : {}),
      } satisfies NutrientValue;
    }),
  };
}

export function aggregateNutritionFacts(factsList: ReadonlyArray<NutritionFacts>): NutritionFacts {
  if (factsList.length === 0) return { nutrients: [] };

  const definitions = new Map<string, NutrientDefinition>();
  for (const facts of factsList) {
    for (const entry of facts.nutrients) definitions.set(entry.nutrient.code, entry.nutrient);
  }

  const nutrients: NutrientValue[] = [];
  for (const [code, definition] of definitions) {
    const entries = factsList.map((facts) => facts.nutrients.find((entry) => entry.nutrient.code === code));
    const incomplete = entries.some((entry) => !entry || entry.state === 'unknown' || entry.value === undefined);

    if (incomplete) {
      nutrients.push({ nutrient: definition, state: 'unknown' });
      continue;
    }

    const present = entries.filter((entry): entry is NutrientValue & { value: number } => Boolean(entry?.value !== undefined));
    const estimated = present.some((entry) => entry.state === 'estimated');
    const firstSource = present[0]?.source;
    const sameSource = firstSource && present.every((entry) => JSON.stringify(entry.source) === JSON.stringify(firstSource));

    nutrients.push({
      nutrient: definition,
      state: estimated ? 'estimated' : 'known',
      value: present.reduce((sum, entry) => sum + entry.value, 0),
      ...(sameSource && firstSource ? { source: firstSource } : {}),
      ...(estimated
        ? {
            confidence: Math.min(
              ...present.map((entry) => entry.confidence ?? (entry.state === 'estimated' ? 0.5 : 1)),
            ),
          }
        : {}),
    });
  }

  return { nutrients };
}

export function nutritionForMeal(meal: Meal, foods: ReadonlyMap<string, Food>): NutritionFacts {
  return aggregateNutritionFacts(
    meal.items.map((item) => {
      const food = foods.get(item.foodId);
      if (!food) throw new Error(`Missing food ${item.foodId} while calculating meal ${meal.id}.`);
      return scaleNutritionFacts(food.nutrition, gramsForFoodPortion(food, item.portion));
    }),
  );
}

export function nutritionForRecipe(recipe: Recipe, foods: ReadonlyMap<string, Food>): NutritionFacts {
  return aggregateNutritionFacts(
    recipe.ingredients.map((ingredient) => {
      const food = foods.get(ingredient.foodId);
      if (!food) throw new Error(`Missing food ${ingredient.foodId} while calculating recipe ${recipe.id}.`);
      if (ingredient.gramWeight === undefined) {
        throw new Error(`Recipe ingredient ${ingredient.foodId} requires gram weight for deterministic calculation.`);
      }
      return scaleNutritionFacts(food.nutrition, ingredient.gramWeight);
    }),
  );
}

export function nutritionPerRecipeServing(recipe: Recipe, foods: ReadonlyMap<string, Food>): NutritionFacts {
  if (recipe.yieldServings <= 0) throw new Error('Recipe yield must be greater than zero.');
  const total = nutritionForRecipe(recipe, foods);

  return {
    nutrients: total.nutrients.map((entry) =>
      entry.value === undefined
        ? { nutrient: entry.nutrient, state: 'unknown' }
        : {
            ...entry,
            value: entry.value / recipe.yieldServings,
          },
    ),
  };
}

export function roundNutritionForDisplay(code: string, value: number): number {
  const decimals = code === 'energy-kcal' ? 0 : code.endsWith('-g') ? 1 : 2;
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

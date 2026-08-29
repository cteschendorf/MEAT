import type { NutritionFacts, NutritionSource } from '@/domain/nutrition/nutrients';
import type { FoodId, FoodServingId, ISODateTime } from '@/domain/shared/ids';

export type FoodKind = 'generic' | 'branded' | 'restaurant' | 'custom' | 'recipe';

export interface FoodServing {
  id: FoodServingId;
  foodId: FoodId;
  label: string;
  gramWeight?: number;
  quantity: number;
  unit: string;
  isDefault?: boolean;
}

export interface Food {
  id: FoodId;
  kind: FoodKind;
  name: string;
  brand?: string;
  barcode?: string;
  nutrition: NutritionFacts;
  servings: readonly FoodServing[];
  primarySource?: NutritionSource;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

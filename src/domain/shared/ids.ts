export type Brand<T, TBrand extends string> = T & { readonly __brand: TBrand };

export type FoodId = Brand<string, 'FoodId'>;
export type FoodServingId = Brand<string, 'FoodServingId'>;
export type MealId = Brand<string, 'MealId'>;
export type MealItemId = Brand<string, 'MealItemId'>;
export type RecipeId = Brand<string, 'RecipeId'>;
export type GoalId = Brand<string, 'GoalId'>;
export type MediaId = Brand<string, 'MediaId'>;
export type UserId = Brand<string, 'UserId'>;
export type SourceRecordId = Brand<string, 'SourceRecordId'>;

export type ISODate = Brand<string, 'ISODate'>;
export type ISODateTime = Brand<string, 'ISODateTime'>;

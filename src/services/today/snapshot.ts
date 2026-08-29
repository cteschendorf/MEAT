import type { Food, Meal, NutrientValue, NutritionGoal } from '@/domain';
import type { FoodRepository, GoalRepository, MealRepository } from '@/data';
import { aggregateNutritionFacts, nutritionForMeal } from '@/services/nutrition/engine';
import { evaluateGoal, type GoalProgress } from '@/services/goals/engine';

export const todayMetricCodes=['energy-kcal','protein-g','carbohydrate-g','fat-g','fiber-g'] as const;
export type TodayMetricCode=(typeof todayMetricCodes)[number];
export interface TodayMetric { code:TodayMetricCode; value:number|null; state:'known'|'unknown'|'estimated'; goal:GoalProgress|null }
export interface TodaySnapshot { dateKey:string; meals:ReadonlyArray<Meal>; metrics:ReadonlyArray<TodayMetric> }

export function localDayRange(date:Date):{start:string;end:string;dateKey:string}{const start=new Date(date);start.setHours(0,0,0,0);const end=new Date(start);end.setDate(end.getDate()+1);const dateKey=`${start.getFullYear()}-${String(start.getMonth()+1).padStart(2,'0')}-${String(start.getDate()).padStart(2,'0')}`;return{start:start.toISOString(),end:end.toISOString(),dateKey}}

async function foodsForMeals(meals:ReadonlyArray<Meal>,repo:FoodRepository):Promise<Map<string,Food>>{const ids=[...new Set(meals.flatMap((m)=>m.items.map((i)=>i.foodId)))];const values=await Promise.all(ids.map((id)=>repo.getById(id)));const map=new Map<string,Food>();values.forEach((food)=>{if(food)map.set(food.id,food)});return map}

export async function buildTodaySnapshot(date:Date,repos:{meals:MealRepository;foods:FoodRepository;goals:GoalRepository}):Promise<TodaySnapshot>{
 const range=localDayRange(date),meals=await repos.meals.listByDateRange(range.start,range.end),foods=await foodsForMeals(meals,repos.foods);
 const totals=aggregateNutritionFacts(meals.map((meal)=>nutritionForMeal(meal,foods)));
 const goals=await repos.goals.listActive(range.end);const goalByCode=new Map<string,NutritionGoal>(goals.map((g)=>[g.nutrientCode,g]));
 const metrics=todayMetricCodes.map((code)=>{const entry=totals.nutrients.find((n)=>n.nutrient.code===code) as NutrientValue|undefined;const value=entry?.value??null;const goal=goalByCode.get(code);return{code,value,state:entry?.state??'unknown',goal:goal&&value!==null?evaluateGoal(goal,value):null} satisfies TodayMetric});
 return{dateKey:range.dateKey,meals,metrics};
}

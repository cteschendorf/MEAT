import type { SQLiteDatabase } from 'expo-sqlite';
import type { Food } from '@/domain';
import type { ISODateTime } from '@/domain/shared/ids';
import { normalizeUsdaFood, type UsdaFoodRecord } from '@/data/food-data/usda';

export type ExternalFoodProviderId='usda-fdc'|'open-food-facts';
export interface ExternalFoodProvider{readonly id:ExternalFoodProviderId;search(query:string):Promise<ReadonlyArray<Food>>;findByBarcode(barcode:string):Promise<Food|null>}

export class ExternalFoodCache{
 constructor(private readonly db:SQLiteDatabase){}
 async get(provider:ExternalFoodProviderId,key:string,now=new Date()):Promise<Food|null>{const row=await this.db.getFirstAsync<{payload:string;expires_at:string|null}>('SELECT payload, expires_at FROM external_food_cache WHERE provider=? AND cache_key=?',provider,key);if(!row||row.expires_at&&new Date(row.expires_at)<=now)return null;return JSON.parse(row.payload) as Food}
 async put(provider:ExternalFoodProviderId,key:string,food:Food,ttlDays=30):Promise<void>{const fetched=new Date(),expires=new Date(fetched.getTime()+ttlDays*86400000);await this.db.runAsync(`INSERT INTO external_food_cache (provider,cache_key,fetched_at,expires_at,payload) VALUES (?,?,?,?,?) ON CONFLICT(provider,cache_key) DO UPDATE SET fetched_at=excluded.fetched_at,expires_at=excluded.expires_at,payload=excluded.payload`,provider,key,fetched.toISOString(),expires.toISOString(),JSON.stringify(food))}
}

export class UsdaFoodDataCentralProvider implements ExternalFoodProvider{
 readonly id='usda-fdc' as const;
 constructor(private readonly apiKey:string){if(!apiKey)throw new Error('USDA FoodData Central API key is required.')}
 private async request<T>(path:string,init?:RequestInit):Promise<T>{const response=await fetch(`https://api.nal.usda.gov/fdc/v1${path}${path.includes('?')?'&':'?'}api_key=${encodeURIComponent(this.apiKey)}`,init);if(!response.ok)throw new Error(`USDA request failed (${response.status}).`);return await response.json() as T}
 async search(query:string):Promise<ReadonlyArray<Food>>{const data=await this.request<{foods?:UsdaFoodRecord[]}>('/foods/search',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query,pageSize:25})});const now=new Date().toISOString() as ISODateTime;return(data.foods??[]).map((item)=>normalizeUsdaFood(item,now))}
 async findByBarcode(barcode:string):Promise<Food|null>{return(await this.search(barcode)).find((food)=>food.barcode===barcode)??null}
}

export class OpenFoodFactsProvider implements ExternalFoodProvider{
 readonly id='open-food-facts' as const;
 constructor(private readonly userAgent:string){if(!userAgent.trim())throw new Error('Open Food Facts requires an identifying User-Agent.')}
 async search():Promise<ReadonlyArray<Food>>{return[]}
 async findByBarcode(barcode:string):Promise<Food|null>{const response=await fetch(`https://world.openfoodfacts.org/api/v3/product/${encodeURIComponent(barcode)}.json`,{headers:{'User-Agent':this.userAgent}});if(response.status===404)return null;if(!response.ok)throw new Error(`Open Food Facts request failed (${response.status}).`);const body=await response.json() as {product?:{product_name?:string;brands?:string;nutriments?:Record<string,number|string|undefined>}};const p=body.product;if(!p?.product_name)return null;const n=p.nutriments??{},source={kind:'external-api' as const,provider:'Open Food Facts'},now=new Date().toISOString() as ISODateTime;const entries:[string,string,'kcal'|'g',number|string|undefined][]=[['energy-kcal','Energy','kcal',n['energy-kcal_100g']],['protein-g','Protein','g',n.proteins_100g],['carbohydrate-g','Carbohydrate','g',n.carbohydrates_100g],['fat-g','Fat','g',n.fat_100g],['fiber-g','Fiber','g',n.fiber_100g]];return{id:`off:${barcode}` as Food['id'],kind:'branded',name:p.product_name,...(p.brands?{brand:p.brands}:{}),barcode,nutrition:{basisGrams:100,nutrients:entries.map(([code,name,unit,raw])=>{const value=typeof raw==='number'?raw:raw!==undefined?Number(raw):undefined;return value!==undefined&&Number.isFinite(value)?{nutrient:{code,name,unit},state:'known' as const,value,source}:{nutrient:{code,name,unit},state:'unknown' as const,source}})},servings:[],primarySource:source,createdAt:now,updatedAt:now}}
}

export interface ExternalResolutionContext{localSearch:(query:string)=>Promise<ReadonlyArray<Food>>;localBarcode:(barcode:string)=>Promise<Food|null>;providers:ReadonlyArray<ExternalFoodProvider>;cache:ExternalFoodCache}
export async function resolveFoodSearch(query:string,c:ExternalResolutionContext):Promise<ReadonlyArray<Food>>{const local=await c.localSearch(query);if(local.length)return local;for(const p of c.providers){try{const results=await p.search(query);if(results.length)return results}catch{continue}}return[]}
export async function resolveFoodBarcode(barcode:string,c:ExternalResolutionContext):Promise<Food|null>{const local=await c.localBarcode(barcode);if(local)return local;for(const p of c.providers){const key=`barcode:${barcode}`,cached=await c.cache.get(p.id,key);if(cached)return cached;try{const result=await p.findByBarcode(barcode);if(result){await c.cache.put(p.id,key,result);return result}}catch{continue}}return null}

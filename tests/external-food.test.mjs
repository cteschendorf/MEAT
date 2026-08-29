import assert from 'node:assert/strict';import{readFile}from'node:fs/promises';import test from'node:test';const read=(p)=>readFile(new URL(p,import.meta.url),'utf8');
test('external cache is provider-segregated',async()=>{const s=await read('../src/data/sqlite/migrations.ts');assert.match(s,/external_food_cache/);assert.match(s,/PRIMARY KEY \(provider,cache_key\)/)});
test('USDA key is runtime-only',async()=>{const s=await read('../src/data/food-data/external.ts');assert.match(s,/private readonly apiKey:string/);assert.doesNotMatch(s,/DEMO_KEY/)});
test('Open Food Facts identifies the app',async()=>{const s=await read('../src/data/food-data/external.ts');assert.match(s,/User-Agent/);assert.match(s,/open-food-facts/)});

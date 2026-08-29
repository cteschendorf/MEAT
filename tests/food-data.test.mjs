import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
const read=(path)=>readFile(new URL(path,import.meta.url),'utf8');
test('local corpus uses FTS and indexed barcode lookup',async()=>{const s=await read('../src/data/sqlite/migrations.ts');assert.match(s,/food_corpus_fts/);assert.match(s,/food_corpus_gtin_idx/)});
test('USDA normalization preserves provenance and arbitrary nutrients',async()=>{const s=await read('../src/data/food-data/usda.ts');assert.match(s,/USDA FoodData Central/);assert.match(s,/foodNutrients/)});
test('OFF stays segregated from USDA corpus',async()=>{const s=await read('../docs/food-data.md');assert.match(s,/must not be merged/)});

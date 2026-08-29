import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));

test('Expo Router is the application entry point', async () => {
  const pkg = await readJson(new URL('../package.json', import.meta.url));
  assert.equal(pkg.main, 'expo-router/entry');
});

test('quality workflow cannot trigger EAS Build', async () => {
  const workflow = await readFile(new URL('../.github/workflows/quality.yml', import.meta.url), 'utf8');
  assert.doesNotMatch(workflow, /\beas\s+build\b/i);
});

test('strict TypeScript remains enabled', async () => {
  const tsconfig = await readJson(new URL('../tsconfig.json', import.meta.url));
  assert.equal(tsconfig.compilerOptions.strict, true);
});

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workflow = await readFile(new URL('../.github/workflows/update_data.yml', import.meta.url), 'utf8');

test('fallback workflow is manual-only and has no database authority', () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /schedule:|PGSQL_|psycopg|git push|contents: write/);
  assert.match(workflow, /ref: main/);
});

test('fallback workflow materializes all compatibility paths', () => {
  assert.match(workflow, /node scripts\/materialize-fallback\.mjs/);
});


test('raw fallback snapshot is not a public static asset', async () => {
  const { access } = await import('node:fs/promises');
  await assert.rejects(() => access(new URL('../public/fallback/current.json', import.meta.url)));
});

test('repository fallback contains no observation-volume signals', async () => {
  const fallback = await readFile(new URL('../src/fallback.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(fallback, /no_data|unknown|"uptime":null|no observed|no data/i);
});

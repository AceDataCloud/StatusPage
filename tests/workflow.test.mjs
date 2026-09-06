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

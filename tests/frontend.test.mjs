import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const app = await readFile(new URL('../public/assets/app.js', import.meta.url), 'utf8');
const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');

test('frontend renders source freshness without cache busting', () => {
  assert.doesNotMatch(app, /Date\.now\(\).*status_|\?t=/);
  assert.match(app, /Generated \$\{formatDate\(data\.generated_at\)\}/);
  assert.match(app, /Data through \$\{formatDate\(data\.data_through\)\}/);
  assert.match(html, /id="stale-banner"/);
});

test('frontend presents no data as neutral unknown and avoids remote innerHTML', () => {
  assert.match(app, /unknown: \{[^\n]+label: 'No Data'[^\n]+bg-slate-200/);
  assert.match(app, /no_data: \['Status Data Unavailable'[^\n]+bg-slate-50/);
  assert.match(app, /bucket\.no_data \? 'No Data'/);
  assert.match(app, /service\.uptime === null \? 'No Data'/);
  assert.doesNotMatch(app, /unknown: \{[^\n]+label: 'Operational'/);
  assert.doesNotMatch(app, /no_data: \['All Systems Operational'/);
  assert.doesNotMatch(app, /innerHTML/);
  assert.match(app, /textContent = service\.title/);
});

test('frontend ignores stale range responses', () => {
  assert.match(app, /requestSequence/);
  assert.match(app, /sequence !== requestSequence \|\| requestedDays !== currentDays/);
});

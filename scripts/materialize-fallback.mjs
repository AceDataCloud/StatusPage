import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { publicRange } from '../src/snapshot.mjs';

const snapshot = JSON.parse(readFileSync(new URL('../public/fallback/current.json', import.meta.url), 'utf8'));
mkdirSync(new URL('../public/data/', import.meta.url), { recursive: true });
for (const days of [1, 7, 30, 90]) {
  const payload = publicRange(snapshot, days, Date.now());
  payload.stale = true;
  writeFileSync(new URL(`../public/data/status_${days}.json`, import.meta.url), `${JSON.stringify(payload)}\n`);
}

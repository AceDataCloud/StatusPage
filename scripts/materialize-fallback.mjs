import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { PUBLIC_FALLBACKS } from '../src/fallback.mjs';
mkdirSync(new URL('../public/data/', import.meta.url), { recursive: true });
for (const days of [1, 7, 30, 90]) {
  const payload = PUBLIC_FALLBACKS[String(days)];
  writeFileSync(new URL(`../public/data/status_${days}.json`, import.meta.url), `${JSON.stringify(payload)}\n`);
}

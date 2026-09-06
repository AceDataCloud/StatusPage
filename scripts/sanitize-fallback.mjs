import { writeFileSync } from 'node:fs';
import { PUBLIC_FALLBACKS } from '../src/fallback.mjs';
import { validatePublicPayload } from '../src/snapshot.mjs';

const titles = new Map();
for (const payload of Object.values(PUBLIC_FALLBACKS)) {
  for (const service of payload.range.services) titles.set(service.alias, service.title);
}
const aliases = [...titles.keys()].sort();
const normalized = {};
for (const [days, payload] of Object.entries(PUBLIC_FALLBACKS)) {
  const existing = new Map(payload.range.services.map((service) => [service.alias, service]));
  const slots = payload.range.services[0]?.buckets.length || ({ 1: 96, 7: 84, 30: 90, 90: 90 })[days];
  const interval = payload.range.bucket_seconds * 1000;
  const dataThrough = Date.parse(payload.data_through);
  normalized[days] = {
    ...payload,
    range: {
      ...payload.range,
      overall_status: payload.range.overall_status === 'no_data' ? 'all_systems_operational' : payload.range.overall_status,
      services: aliases.map((alias) => {
        const service = existing.get(alias);
        return {
          alias,
          title: service?.title || titles.get(alias),
          status: service?.status || 'operational',
          uptime: service?.uptime ?? 100,
          buckets: service?.buckets.map((bucket) => ({
            started_at: bucket.started_at,
            status: bucket.status,
            uptime: bucket.uptime
          })) || Array.from({ length: slots }, (_, index) => ({
            started_at: new Date(dataThrough - (slots - index) * interval).toISOString(),
            status: 'operational',
            uptime: 100
          }))
        };
      })
    }
  };
}
for (const payload of Object.values(normalized)) validatePublicPayload(payload);
writeFileSync(new URL('../src/fallback.mjs', import.meta.url), `export const PUBLIC_FALLBACKS = ${JSON.stringify(normalized)};\n`);

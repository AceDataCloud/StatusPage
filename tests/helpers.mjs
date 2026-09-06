import { randomUUID } from 'node:crypto';
import { RANGE_SPECS } from '../src/snapshot.mjs';

export function snapshot(now = Date.now()) {
  const dataThroughMs = Math.floor((now - 60_000) / 900_000) * 900_000;
  const generated = new Date(dataThroughMs + 60_000).toISOString();
  const dataThrough = new Date(dataThroughMs).toISOString();
  const ranges = {};
  for (const [key, spec] of Object.entries(RANGE_SPECS)) {
    const start = dataThroughMs - spec.slots * spec.bucketSeconds * 1000;
    ranges[key] = {
      days: spec.days,
      bucket_seconds: spec.bucketSeconds,
      overall_status: 'all_systems_operational',
      services: [{
        alias: 'openai', title: 'OpenAI', status: 'operational', uptime: 100,
        buckets: Array.from({ length: spec.slots }, (_, index) => ({
          started_at: new Date(start + index * spec.bucketSeconds * 1000).toISOString(),
          status: 'operational', uptime: 100, no_data: false
        }))
      }]
    };
  }
  return {
    schema_version: 1,
    generation: randomUUID(),
    generated_at: generated,
    data_through: dataThrough,
    stale_after_seconds: 900,
    policy_version: 1,
    ranges
  };
}

export function kv(initial = null) {
  let value = initial;
  let metadata = null;
  return {
    async get(_key, options) { return options?.type === 'json' && typeof value === 'string' ? JSON.parse(value) : value; },
    async getWithMetadata(_key, options) {
      const result = options?.type === 'json' && typeof value === 'string' ? JSON.parse(value) : value;
      return { value: result, metadata };
    },
    async put(_key, next, options) { value = next; metadata = options?.metadata || null; },
    state() { return { value, metadata }; }
  };
}

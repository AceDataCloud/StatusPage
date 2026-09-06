import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const specs = { 1: { seconds: 900, slots: 96 }, 7: { seconds: 7200, slots: 84 }, 30: { seconds: 28800, slots: 90 }, 90: { seconds: 86400, slots: 90 } };
const sources = Object.fromEntries(Object.keys(specs).map((days) => [days, JSON.parse(readFileSync(new URL(`../data/status_${days}.json`, import.meta.url), 'utf8'))]));

function timestamp(value) {
  const normalized = value.length === 10 ? `${value}T00:00:00Z` : `${value}:00Z`;
  const parsed = Date.parse(normalized);
  if (!Number.isFinite(parsed)) throw new Error(`invalid fallback timestamp: ${value}`);
  return parsed;
}

const ends = [];
for (const [days, source] of Object.entries(sources)) {
  const times = (source.services || []).flatMap((service) => (service.daily || []).map((bucket) => timestamp(bucket.date)));
  if (times.length) ends.push(Math.max(...times) + specs[days].seconds * 1000);
}
const dataThroughMs = ends.length ? Math.max(...ends) : Date.parse('2026-08-08T12:45:00Z');
const ranges = {};

function normalizeBuckets(source, spec) {
  const byTime = new Map((source || []).map((bucket) => [timestamp(bucket.date), bucket]));
  const start = dataThroughMs - spec.slots * spec.seconds * 1000;
  return Array.from({ length: spec.slots }, (_, index) => {
    const startedAt = start + index * spec.seconds * 1000;
    const bucket = byTime.get(startedAt);
    const noData = !bucket?.total_requests;
    const uptime = noData ? null : Math.round(bucket.uptime * 10) / 10;
    return {
      started_at: new Date(startedAt).toISOString(),
      status: noData ? 'unknown' : uptime >= 95 ? 'operational' : uptime >= 80 ? 'degraded' : uptime >= 50 ? 'partial_outage' : 'major_outage',
      uptime,
      no_data: noData
    };
  });
}

for (const [days, spec] of Object.entries(specs)) {
  const source = sources[days];
  const services = (source.services || []).filter((service) => service.service_alias !== 'deepseek').map((service) => ({
    alias: service.service_alias,
    title: service.service_alias,
    status: service.current_status || 'unknown',
    uptime: Number.isFinite(service.uptime_90d) ? Math.round(service.uptime_90d * 10) / 10 : null,
    buckets: normalizeBuckets(service.daily, spec)
  }));
  const statuses = services.map((service) => service.status).filter((status) => status !== 'unknown');
  const overall = !statuses.length ? 'no_data' : statuses.includes('major_outage') ? 'major_system_outage' : statuses.includes('partial_outage') ? 'partial_system_outage' : statuses.includes('degraded') ? 'minor_service_disruption' : 'all_systems_operational';
  ranges[days] = { days: Number(days), bucket_seconds: spec.seconds, overall_status: overall, services };
}

const dataThrough = new Date(dataThroughMs).toISOString();
const content = JSON.stringify({ data_through: dataThrough, ranges });
const digest = createHash('sha256').update(content).digest('hex');
const generation = `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-8${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
const snapshot = { schema_version: 1, generation, generated_at: dataThrough, data_through: dataThrough, stale_after_seconds: 900, policy_version: 1, ranges };
mkdirSync(new URL('../public/fallback/', import.meta.url), { recursive: true });
writeFileSync(new URL('../public/fallback/current.json', import.meta.url), `${JSON.stringify(snapshot)}\n`);

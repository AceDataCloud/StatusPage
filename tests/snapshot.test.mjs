import assert from 'node:assert/strict';
import test from 'node:test';
import { publicRange, responseEtag, validateSnapshot } from '../src/snapshot.mjs';
import { snapshot } from './helpers.mjs';

const now = Date.parse('2026-09-06T12:00:00Z');

test('validates all ranges and selects a public range', () => {
  const value = snapshot(now);
  assert.equal(validateSnapshot(value, now), value);
  assert.equal(publicRange(value, 7, now).range.days, 7);
});

test('rejects missing ranges and forbidden traffic fields', () => {
  const missing = snapshot(now);
  delete missing.ranges['90'];
  assert.throws(() => validateSnapshot(missing, now), /exactly four ranges/);
  const leaked = snapshot(now);
  leaked.ranges['1'].services[0].total_requests = 12;
  assert.throws(() => validateSnapshot(leaked, now), /forbidden field/);
});

test('rejects wrong buckets, future and stale ingestion snapshots', () => {
  const wrong = snapshot(now);
  wrong.ranges['1'].services[0].buckets.pop();
  assert.throws(() => validateSnapshot(wrong, now), /wrong bucket count/);
  const future = snapshot(now + 30 * 60_000);
  assert.throws(() => validateSnapshot(future, now), /future/);
  const stale = snapshot(now - 2 * 60 * 60_000);
  assert.throws(() => validateSnapshot(stale, now), /too old/);
  assert.equal(validateSnapshot(stale, now, { allowStale: true }), stale);
});

test('freshness is included in the ETag', () => {
  const value = snapshot(now);
  const fresh = publicRange(value, 1, now);
  const stale = publicRange(value, 1, now + 20 * 60_000);
  assert.notEqual(responseEtag(fresh), responseEtag(stale));
});


test('sanitized fallback preserves outage severity', async () => {
  const { PUBLIC_FALLBACKS } = await import('../src/fallback.mjs');
  const fallback = { ranges: Object.fromEntries(Object.entries(PUBLIC_FALLBACKS).map(([key, value]) => [key, value.range])) };
  for (const range of Object.values(fallback.ranges)) {
    const statuses = range.services.map((service) => service.status);
    if (statuses.includes('major_outage')) assert.equal(range.overall_status, 'major_system_outage');
    else if (statuses.includes('partial_outage')) assert.equal(range.overall_status, 'partial_system_outage');
    else if (statuses.includes('degraded')) assert.equal(range.overall_status, 'minor_service_disruption');
  }
});


test('rejects shifted and irregular bucket timelines', () => {
  const shifted = snapshot(now);
  shifted.ranges['1'].services[0].buckets[0].started_at = new Date(now - 95 * 900_000).toISOString();
  assert.throws(() => validateSnapshot(shifted, now), /bucket timeline|bucket interval/);
  const irregular = snapshot(now);
  irregular.ranges['7'].services[0].buckets[4].started_at = new Date(now - 79 * 7_200_000 + 1_000).toISOString();
  assert.throws(() => validateSnapshot(irregular, now), /bucket timeline|bucket interval/);
});

test('public ETags invalidate pre-privacy caches', () => {
  const payload = publicRange(snapshot(now), 1, now);
  assert.match(responseEtag(payload), /^"privacy-v2-/);
});


test('unknown current status preserves non-null historical uptime', () => {
  const value = snapshot(now);
  value.ranges['1'].services[0].status = 'unknown';
  value.ranges['1'].services[0].uptime = 97.4;
  const projected = publicRange(value, 1, now).range.services[0];
  assert.equal(projected.status, 'operational');
  assert.equal(projected.uptime, 97.4);
});

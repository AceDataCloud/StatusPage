import assert from 'node:assert/strict';
import test from 'node:test';
import { onRequest } from '../functions/data/[filename].js';
import { kv, snapshot } from './helpers.mjs';

const now = Date.now();

function context(filename, store, method = 'GET', fallback = null) {
  return {
    params: { filename },
    request: new Request(`https://status.example/data/${filename}`, { method }),
    env: {
      STATUS_SNAPSHOT: store,
      ASSETS: { async fetch() { return fallback ? Response.json(fallback) : new Response('missing', { status: 404 }); } }
    }
  };
}

test('serves each compatibility path from the atomic KV document', async () => {
  const value = snapshot(now);
  const response = await onRequest(context('status_30.json', kv(value)));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.range.days, 30);
  assert.equal(body.generation, value.generation);
  assert.equal(response.headers.get('X-Status-Stale'), '0');
});

test('rejects unknown paths and writes', async () => {
  assert.equal((await onRequest(context('other.json', kv()))).status, 404);
  assert.equal((await onRequest(context('status_1.json', kv(), 'POST'))).status, 405);
});

test('empty KV serves only an explicitly stale sanitized fallback', async () => {
  const fallback = snapshot(now - 24 * 60 * 60_000);
  const response = await onRequest(context('status_1.json', kv(), 'GET', fallback));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.stale, true);
  assert.equal(response.headers.get('Warning'), '110 - "Status snapshot is stale"');
});


test('KV read errors fall back instead of returning 500', async () => {
  const fallback = snapshot(now - 24 * 60 * 60_000);
  const broken = { async get() { throw new Error('KV unavailable'); } };
  const response = await onRequest(context('status_7.json', broken, 'GET', fallback));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).stale, true);
});

test('public responses reveal no observation-volume signals', async () => {
  const value = snapshot(now);
  value.ranges['1'].overall_status = 'no_data';
  value.ranges['1'].services[0].status = 'unknown';
  value.ranges['1'].services[0].uptime = null;
  value.ranges['1'].services[0].buckets[0] = {
    ...value.ranges['1'].services[0].buckets[0],
    status: 'unknown',
    uptime: null,
    no_data: true
  };
  const response = await onRequest(context('status_1.json', kv(value)));
  const body = await response.json();
  const serialized = JSON.stringify(body);
  assert.equal(body.range.overall_status, 'all_systems_operational');
  assert.equal(body.range.services[0].status, 'operational');
  assert.equal(body.range.services[0].uptime, 100);
  assert.equal(body.range.services[0].buckets[0].status, 'operational');
  assert.equal(body.range.services[0].buckets[0].uptime, 100);
  assert.doesNotMatch(serialized, /no_data|unknown|"uptime":null/);
});


test('every range exposes the same service set', async () => {
  const value = snapshot(now);
  value.ranges['1'].services.push({
    alias: 'only-in-one-range',
    title: 'Only In One Range',
    status: 'unknown',
    uptime: null,
    buckets: value.ranges['1'].services[0].buckets.map((bucket) => ({
      ...bucket, status: 'unknown', uptime: null, no_data: true
    }))
  });
  const one = await (await onRequest(context('status_1.json', kv(value)))).json();
  const seven = await (await onRequest(context('status_7.json', kv(value)))).json();
  assert.deepEqual(one.range.services.map((service) => service.alias), seven.range.services.map((service) => service.alias));
  const synthesized = seven.range.services.find((service) => service.alias === 'only-in-one-range');
  assert.equal(synthesized.status, 'operational');
  assert.equal(synthesized.uptime, 100);
});

test('fallback rejects any future unexpected sensitive fields', async () => {
  const { PUBLIC_FALLBACKS } = await import('../src/fallback.mjs');
  const original = PUBLIC_FALLBACKS['1'].range.services[0];
  original.total_requests = 123;
  const response = await onRequest(context('status_1.json', kv()));
  delete original.total_requests;
  assert.equal(response.status, 503);
});

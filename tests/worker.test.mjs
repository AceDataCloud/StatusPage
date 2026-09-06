import assert from 'node:assert/strict';
import test from 'node:test';
import { MAX_SNAPSHOT_BYTES } from '../src/snapshot.mjs';
import { refreshSnapshot } from '../worker/index.mjs';
import { kv, snapshot } from './helpers.mjs';

const now = Date.parse('2026-09-06T12:00:00Z');

function env(store) {
  return { STATUS_SNAPSHOT: store, BACKEND_STATUS_URL: 'https://platform.acedata.cloud/api/v1/status-page/snapshot/', STATUSPAGE_INTERNAL_TOKEN: 'secret' };
}

test('stores one complete validated snapshot', async () => {
  const store = kv();
  const value = snapshot(now);
  const result = await refreshSnapshot(env(store), async (_url, init) => {
    assert.equal(init.headers['X-Internal-Token'], 'secret');
    assert.equal(init.redirect, 'manual');
    return new Response(JSON.stringify(value), { status: 200, headers: { ETag: 'backend-etag' } });
  }, now);
  assert.equal(result.updated, true);
  assert.equal(JSON.parse(store.state().value).generation, value.generation);
  assert.equal(store.state().metadata.etag, 'backend-etag');
});

test('304 and failures preserve the last good snapshot', async () => {
  const original = JSON.stringify(snapshot(now));
  const store = kv(original);
  assert.deepEqual(await refreshSnapshot(env(store), async () => new Response(null, { status: 304 }), now), { updated: false, reason: 'not-modified' });
  assert.equal(store.state().value, original);
  await assert.rejects(() => refreshSnapshot(env(store), async () => new Response('bad', { status: 500 }), now), /returned 500/);
  assert.equal(store.state().value, original);
});

test('oversized or invalid bodies never overwrite KV', async () => {
  const original = JSON.stringify(snapshot(now));
  const store = kv(original);
  await assert.rejects(
    () => refreshSnapshot(env(store), async () => new Response('x', { status: 200, headers: { 'Content-Length': String(MAX_SNAPSHOT_BYTES + 1) } }), now),
    /too large/
  );
  assert.equal(store.state().value, original);
  await assert.rejects(() => refreshSnapshot(env(store), async () => new Response('{}'), now), /schema_version/);
  assert.equal(store.state().value, original);
});


test('timeout covers a response body that never finishes', async () => {
  const original = JSON.stringify(snapshot(now));
  const store = kv(original);
  const hangingFetch = async (_url, init) => ({
    status: 200,
    ok: true,
    headers: new Headers(),
    text: () => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    })
  });
  await assert.rejects(() => refreshSnapshot(env(store), hangingFetch, now, 5), /Abort/);
  assert.equal(store.state().value, original);
});


test('authenticated refresh accepts an old rollback snapshot and preserves stale truth', async () => {
  const store = kv(JSON.stringify(snapshot(now)));
  const rollback = snapshot(now - 24 * 60 * 60_000);
  const result = await refreshSnapshot(env(store), async () => Response.json(rollback), now);
  assert.equal(result.updated, true);
  assert.equal(JSON.parse(store.state().value).generation, rollback.generation);
});


test('redirect responses are rejected without overwriting KV', async () => {
  const original = JSON.stringify(snapshot(now));
  const store = kv(original);
  await assert.rejects(
    () => refreshSnapshot(env(store), async () => new Response(null, { status: 302, headers: { Location: 'https://example.com/' } }), now),
    /redirect was rejected/
  );
  assert.equal(store.state().value, original);
});

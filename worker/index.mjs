import { CURRENT_KEY, MAX_SNAPSHOT_BYTES, validateSnapshot } from '../src/snapshot.mjs';

export async function refreshSnapshot(env, fetchImpl = fetch, now = Date.now(), timeoutMs = 10_000) {
  if (!env.BACKEND_STATUS_URL || !env.STATUSPAGE_INTERNAL_TOKEN) {
    throw new Error('status refresh is not configured');
  }
  const current = await env.STATUS_SNAPSHOT.getWithMetadata(CURRENT_KEY, { type: 'json' });
  const headers = { 'X-Internal-Token': env.STATUSPAGE_INTERNAL_TOKEN };
  if (current.metadata?.etag) headers['If-None-Match'] = current.metadata.etag;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  let body;
  try {
    response = await fetchImpl(env.BACKEND_STATUS_URL, {
      headers,
      redirect: 'manual',
      signal: controller.signal
    });
    if (response.status === 304) return { updated: false, reason: 'not-modified' };
    if (response.status >= 300 && response.status < 400) throw new Error('status backend redirect was rejected');
    if (!response.ok) throw new Error(`status backend returned ${response.status}`);
    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength > MAX_SNAPSHOT_BYTES) throw new Error('snapshot is too large');
    body = await response.text();
  } finally {
    clearTimeout(timeout);
  }
  if (new TextEncoder().encode(body).byteLength > MAX_SNAPSHOT_BYTES) throw new Error('snapshot is too large');
  const snapshot = validateSnapshot(JSON.parse(body), now, { allowStale: true });
  const etag = response.headers.get('etag') || snapshot.generation;
  await env.STATUS_SNAPSHOT.put(CURRENT_KEY, body, {
    metadata: { etag, generation: snapshot.generation, fetched_at: new Date(now).toISOString() }
  });
  return { updated: true, generation: snapshot.generation };
}

export default {
  async fetch() {
    return new Response('Not Found', { status: 404 });
  },
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(
      refreshSnapshot(env).catch((error) => {
        console.error(JSON.stringify({ event: 'status_refresh_failed', error: String(error) }));
        throw error;
      })
    );
  }
};

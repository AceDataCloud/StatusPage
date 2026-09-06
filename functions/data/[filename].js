import { PUBLIC_FALLBACKS } from '../../src/fallback.mjs';
import { CURRENT_KEY, publicRange, responseEtag, validatePublicPayload, validateSnapshot } from '../../src/snapshot.mjs';

const CORS = Object.freeze({ 'Access-Control-Allow-Origin': '*' });

const FILES = Object.freeze({
  'status_1.json': 1,
  'status_7.json': 7,
  'status_30.json': 30,
  'status_90.json': 90
});

export async function onRequestGet(context) {
  const filename = context.params.filename;
  const days = FILES[filename];
  if (!days) return new Response('Not Found', { status: 404, headers: CORS });

  let snapshot;
  let fallback = false;
  try {
    snapshot = await context.env.STATUS_SNAPSHOT.get(CURRENT_KEY, { type: 'json' });
  } catch (error) {
    console.error(JSON.stringify({ event: 'status_kv_read_failed', error: String(error) }));
    fallback = true;
  }
  let payload;
  try {
    if (!snapshot) {
      payload = validatePublicPayload(structuredClone(PUBLIC_FALLBACKS[String(days)]));
      fallback = true;
    } else {
      validateSnapshot(snapshot, Date.now(), { allowStale: true });
      payload = publicRange(snapshot, days);
    }
  } catch (error) {
    console.error(JSON.stringify({ event: 'status_serve_validation_failed', error: String(error) }));
    return new Response('Status snapshot unavailable', { status: 503, headers: CORS });
  }
  if (fallback) payload.stale = true;
  const etag = responseEtag(payload);
  if (context.request.headers.get('if-none-match') === etag) {
    return new Response(null, { status: 304, headers: { ...CORS, ETag: etag, 'Cache-Control': 'public, max-age=60' } });
  }
  const headers = {
    ...CORS,
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'public, max-age=60, s-maxage=120, stale-while-revalidate=300',
    ETag: etag,
    'Last-Modified': new Date(payload.generated_at).toUTCString(),
    'X-Status-Generated-At': payload.generated_at,
    'X-Status-Data-Through': payload.data_through,
    'X-Status-Stale': payload.stale ? '1' : '0'
  };
  if (payload.stale) headers.Warning = '110 - "Status snapshot is stale"';
  return Response.json(payload, { headers });
}

export function onRequest(context) {
  if (context.request.method !== 'GET' && context.request.method !== 'HEAD') {
    return new Response('Method Not Allowed', { status: 405, headers: { ...CORS, Allow: 'GET, HEAD' } });
  }
  return onRequestGet(context);
}

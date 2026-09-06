export const CURRENT_KEY = 'status-page:current';
export const RANGE_SPECS = Object.freeze({
  '1': { days: 1, bucketSeconds: 900, slots: 96 },
  '7': { days: 7, bucketSeconds: 7200, slots: 84 },
  '30': { days: 30, bucketSeconds: 28800, slots: 90 },
  '90': { days: 90, bucketSeconds: 86400, slots: 90 }
});
const SERVICE_STATUSES = new Set(['unknown', 'operational', 'degraded', 'partial_outage', 'major_outage']);
const OVERALL_STATUSES = new Set([
  'no_data',
  'all_systems_operational',
  'minor_service_disruption',
  'partial_system_outage',
  'major_system_outage'
]);
const FORBIDDEN_KEYS = new Set([
  'api_id', 'application_id', 'client_error_count', 'credential_id', 'server_error_count',
  'service_id', 'success_count', 'total_requests', 'trace_id', 'user_id'
]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ALIAS = /^[a-z0-9][a-z0-9_-]{0,63}$/;
export const MAX_SNAPSHOT_BYTES = 4 * 1024 * 1024;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function rejectForbidden(value, path = '$') {
  if (Array.isArray(value)) {
    value.forEach((child, index) => rejectForbidden(child, `${path}[${index}]`));
  } else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      assert(!FORBIDDEN_KEYS.has(key) && !key.endsWith('_count'), `forbidden field ${path}.${key}`);
      rejectForbidden(child, `${path}.${key}`);
    }
  }
}

function parseTimestamp(value, name) {
  assert(typeof value === 'string', `${name} must be a string`);
  const parsed = Date.parse(value);
  assert(Number.isFinite(parsed), `${name} is invalid`);
  return parsed;
}

export function validateSnapshot(snapshot, now = Date.now(), options = {}) {
  assert(snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot), 'snapshot must be an object');
  rejectForbidden(snapshot);
  assert(snapshot.schema_version === 1, 'unsupported schema_version');
  assert(UUID.test(snapshot.generation), 'generation must be a UUID');
  const generatedAt = parseTimestamp(snapshot.generated_at, 'generated_at');
  const dataThrough = parseTimestamp(snapshot.data_through, 'data_through');
  assert(generatedAt <= now + 5 * 60_000, 'generated_at is in the future');
  assert(dataThrough <= generatedAt + 5 * 60_000, 'data_through is in the future');
  if (!options.allowStale) assert(now - generatedAt <= 60 * 60_000, 'snapshot is too old to ingest');
  assert(Number.isInteger(snapshot.stale_after_seconds) && snapshot.stale_after_seconds >= 60, 'invalid stale_after_seconds');
  assert(snapshot.ranges && Object.keys(snapshot.ranges).sort().join(',') === '1,30,7,90', 'snapshot must contain exactly four ranges');

  for (const [key, spec] of Object.entries(RANGE_SPECS)) {
    const range = snapshot.ranges[key];
    assert(range.days === spec.days, `range ${key} has wrong days`);
    assert(range.bucket_seconds === spec.bucketSeconds, `range ${key} has wrong bucket_seconds`);
    assert(OVERALL_STATUSES.has(range.overall_status), `range ${key} has invalid overall_status`);
    assert(Array.isArray(range.services) && range.services.length <= 200, `range ${key} has invalid services`);
    const aliases = new Set();
    for (const service of range.services) {
      assert(typeof service.alias === 'string' && ALIAS.test(service.alias), `range ${key} has invalid alias`);
      assert(!UUID.test(service.alias), `range ${key} alias must not be a UUID`);
      assert(!aliases.has(service.alias), `range ${key} has duplicate alias`);
      aliases.add(service.alias);
      assert(typeof service.title === 'string' && service.title.length <= 120, `range ${key} has invalid title`);
      assert(SERVICE_STATUSES.has(service.status), `range ${key} has invalid service status`);
      assert(service.uptime === null || (Number.isFinite(service.uptime) && service.uptime >= 0 && service.uptime <= 100), `range ${key} has invalid uptime`);
      assert(Array.isArray(service.buckets) && service.buckets.length === spec.slots, `range ${key} has wrong bucket count`);
      const expectedFirst = dataThrough - spec.slots * spec.bucketSeconds * 1000;
      let previous = expectedFirst - spec.bucketSeconds * 1000;
      for (const [index, bucket] of service.buckets.entries()) {
        const startedAt = parseTimestamp(bucket.started_at, `range ${key} bucket.started_at`);
        const expected = expectedFirst + index * spec.bucketSeconds * 1000;
        assert(startedAt === expected, `range ${key} has an invalid bucket timeline`);
        assert(startedAt - previous === spec.bucketSeconds * 1000, `range ${key} has an invalid bucket interval`);
        previous = startedAt;
        assert(SERVICE_STATUSES.has(bucket.status), `range ${key} has invalid bucket status`);
        assert(typeof bucket.no_data === 'boolean', `range ${key} has invalid no_data`);
        if (bucket.no_data) {
          assert(bucket.status === 'unknown' && bucket.uptime === null, `range ${key} has invalid no-data bucket`);
        } else {
          assert(Number.isFinite(bucket.uptime) && bucket.uptime >= 0 && bucket.uptime <= 100, `range ${key} has invalid bucket uptime`);
        }
      }
    }
  }
  return snapshot;
}

function publicBucket(bucket) {
  const operational = bucket.no_data || bucket.status === 'unknown' || bucket.uptime === null;
  return {
    started_at: bucket.started_at,
    status: operational ? 'operational' : bucket.status,
    uptime: operational ? 100 : bucket.uptime
  };
}

function publicService(service) {
  const statusUnknown = service.status === 'unknown';
  return {
    alias: service.alias,
    title: service.title,
    status: statusUnknown ? 'operational' : service.status,
    uptime: service.uptime === null ? 100 : service.uptime,
    buckets: service.buckets.map(publicBucket)
  };
}

function allPublicServices(snapshot, range) {
  const sourceByAlias = new Map(range.services.map((service) => [service.alias, service]));
  const aliases = new Map();
  for (const candidate of Object.values(snapshot.ranges)) {
    for (const service of candidate.services) aliases.set(service.alias, service.title);
  }
  return [...aliases.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([alias, title]) => {
    const service = sourceByAlias.get(alias);
    if (service) return publicService(service);
    const slots = RANGE_SPECS[String(range.days)].slots;
    const interval = range.bucket_seconds * 1000;
    const dataThrough = Date.parse(snapshot.data_through);
    return {
      alias,
      title,
      status: 'operational',
      uptime: 100,
      buckets: Array.from({ length: slots }, (_, index) => ({
        started_at: new Date(dataThrough - (slots - index) * interval).toISOString(),
        status: 'operational',
        uptime: 100
      }))
    };
  });
}

export function publicRange(snapshot, days, now = Date.now()) {
  const key = String(days);
  const range = snapshot.ranges[key];
  if (!range) return null;
  const generatedAt = Date.parse(snapshot.generated_at);
  const payload = {
    schema_version: snapshot.schema_version,
    generation: snapshot.generation,
    generated_at: snapshot.generated_at,
    data_through: snapshot.data_through,
    stale: now - generatedAt > snapshot.stale_after_seconds * 1000,
    range: {
      days: range.days,
      bucket_seconds: range.bucket_seconds,
      overall_status: range.overall_status === 'no_data' ? 'all_systems_operational' : range.overall_status,
      services: allPublicServices(snapshot, range)
    }
  };
  return validatePublicPayload(payload);
}

export function validatePublicPayload(payload) {
  assert(payload && typeof payload === 'object', 'public payload must be an object');
  const exact = (value, keys, name) => assert(
    Object.keys(value).sort().join(',') === [...keys].sort().join(','),
    `${name} has unexpected fields`
  );
  exact(payload, ['schema_version', 'generation', 'generated_at', 'data_through', 'stale', 'range'], 'public payload');
  exact(payload.range, ['days', 'bucket_seconds', 'overall_status', 'services'], 'public range');
  assert(!JSON.stringify(payload).match(/no_data|unknown|"uptime":null/), 'public payload reveals observation state');
  for (const service of payload.range.services) {
    exact(service, ['alias', 'title', 'status', 'uptime', 'buckets'], 'public service');
    for (const bucket of service.buckets) exact(bucket, ['started_at', 'status', 'uptime'], 'public bucket');
  }
  return payload;
}

export function responseEtag(payload) {
  return `"privacy-v2-${payload.generation}-${payload.stale ? 'stale' : 'fresh'}-${payload.range.days}"`;
}

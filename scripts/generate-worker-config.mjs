import { readFileSync, writeFileSync } from 'node:fs';

const kvId = process.env.STATUS_SNAPSHOT_KV_ID;
const backendUrl = process.env.BACKEND_STATUS_URL;
if (!kvId || !backendUrl) {
  throw new Error('STATUS_SNAPSHOT_KV_ID and BACKEND_STATUS_URL are required');
}
const config = JSON.parse(readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
config.kv_namespaces = [{ binding: 'STATUS_SNAPSHOT', id: kvId }];
config.vars = { BACKEND_STATUS_URL: backendUrl };
writeFileSync(new URL('../.wrangler.generated.jsonc', import.meta.url), `${JSON.stringify(config, null, 2)}\n`);

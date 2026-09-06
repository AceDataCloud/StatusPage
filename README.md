# StatusPage

Observed API availability for Ace Data Cloud services.

## Architecture

```text
PlatformBackend bounded aggregation
  -> authenticated public-edge snapshot endpoint
  -> scheduled Cloudflare Worker
  -> one atomic Workers KV document
  -> Pages Function /data/status_{1,7,30,90}.json
  -> static Cloudflare Pages UI
```

The Worker has no database credentials. A failed refresh never overwrites the last good KV document. If KV is unavailable, the Pages Function serves a sanitized checked-in fallback and marks it stale.

The page reports outcomes observed from completed API traffic. No traffic is shown as `No Data`; it is not treated as proof that a service is operational.

## Local verification

```bash
npm install
npm test
node scripts/sanitize-fallback.mjs
```

Open `public/index.html` through a local static server. The production data paths are handled by the Pages Function.

## Cloudflare configuration

The scheduled Worker needs:

- `STATUS_SNAPSHOT_KV_ID` at build time
- `BACKEND_STATUS_URL` at build time
- `STATUSPAGE_INTERNAL_TOKEN` as a Worker runtime secret
- `CLOUDFLARE_ACCOUNT_ID` and a narrowly scoped API token in Workers Builds

The Pages project publishes `public/`, enables Functions, and binds the same KV namespace as `STATUS_SNAPSHOT`. Production deploys from `main`; pull requests use preview deployments.

Do not commit generated Wrangler configuration or secrets. `scripts/generate-worker-config.mjs` creates `.wrangler.generated.jsonc` only inside the build environment.

## Refresh and freshness

- PlatformBackend completes one aggregate bucket every 15 minutes.
- The scheduled Worker runs two minutes later at `04,19,34,49` UTC minutes.
- The page refreshes once per minute using normal HTTP caching and ETags.
- Snapshots older than the backend freshness threshold are visibly marked delayed.

## Rollback

`status.acedata.cloud` remains on GitHub Pages until Cloudflare shadow validation passes. After cutover, restore the previous DNSPod CNAME to `acedatacloud.github.io` to roll back the frontend. The manual `Deploy GitHub Pages Fallback` workflow publishes only `public/`; it never connects to PostgreSQL or generates data.

# StatusPage

Static status page for Ace Data Cloud services, hosted at `status.acedata.cloud`.

## Architecture

- **Data source**: `ServiceUptime` table in PlatformBackend (pre-aggregated from `ApiUsage`)
- **API**: `GET /api/v1/status/` on PlatformBackend (public, no auth)
- **Frontend**: Static HTML + Tailwind CSS + vanilla JS (this project)
- **Aggregation**: CronJob `health.py` runs hourly, aggregates ApiUsage → ServiceUptime

## How It Works

1. CronJob `health.py` (in PlatformBackend) runs every hour
2. It reads `ApiUsage` records from the past 2 days
3. Groups by (service, date), counts success/error rates
4. Upserts into `ServiceUptime` table
5. This static page fetches `/api/v1/status/` and renders 90-day uptime bars

## Development

Just open `index.html` in a browser. The page fetches live data from the API.

## Deployment

Deployed via GitHub Pages. Push to `main` triggers the deploy workflow.

DNS: `status.acedata.cloud` → GitHub Pages CNAME.

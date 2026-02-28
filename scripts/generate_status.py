#!/usr/bin/env python3
"""
Generate status page JSON data by directly querying PostgreSQL.

Replaces the old approach of calling the PlatformBackend HTTP API,
which caused timeout cascades under load.

Usage:
    python scripts/generate_status.py

Requires env vars:
    PGSQL_HOST, PGSQL_PORT, PGSQL_USER, PGSQL_PASSWORD
    PGSQL_DATABASE (default: acedatacloud_platform)

Outputs:
    data/status_1.json   — 24h,  15-min buckets (96 bars)
    data/status_7.json   — 7d,   2-hour buckets (84 bars)
    data/status_30.json  — 30d,  8-hour buckets (90 bars)
    data/status_90.json  — 90d,  daily from pre-aggregated table
"""

import json
import os
import re
import sys
from collections import defaultdict
from datetime import datetime, timedelta, timezone

try:
    import psycopg2
    import psycopg2.extras
except ImportError:
    print("Installing psycopg2-binary...")
    os.system(f"{sys.executable} -m pip install psycopg2-binary -q")
    import psycopg2
    import psycopg2.extras

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

BUCKET_CONFIG = {
    1: (15, 96, "quarter"),    # 15 min → 96 bars
    7: (120, 84, "2hour"),     # 2 hours → 84 bars
    30: (480, 90, "8hour"),    # 8 hours → 90 bars
}

MIN_REQUESTS_BY_DAYS = {90: 200, 30: 70, 7: 16, 1: 3}

EXCLUDED_ALIASES = {
    "hcaptcha", "recaptcha", "face_change", "identity",
    "adsl_http_proxy", "shorturl", "localization", "image2text",
    "chatdoc", "tw", "producer", "drawai", "fish", "qrart", "riffusion",
}

OUTPUT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def get_connection():
    return psycopg2.connect(
        host=os.environ["PGSQL_HOST"],
        port=int(os.environ.get("PGSQL_PORT", 5432)),
        user=os.environ["PGSQL_USER"],
        password=os.environ["PGSQL_PASSWORD"],
        dbname=os.environ.get("PGSQL_DATABASE", "acedatacloud_platform"),
        connect_timeout=30,
        options="-c statement_timeout=120000",  # 120s max per query
    )


def derive_alias(alias, title):
    """Derive a display alias for a service."""
    if alias:
        return alias
    if title:
        m = re.search(r"service_title_(\w+)", title)
        if m:
            return m.group(1)
    return None


def build_api_to_service_map(conn):
    """Build api_id -> {service_id, alias, title} lookup from DB."""
    sql = """
        SELECT a.id::text, s.id::text, s.alias, s.title
        FROM app_api a
        JOIN app_service s ON a.service_id = s.id
        WHERE a.service_id IS NOT NULL
    """
    mapping = {}
    with conn.cursor() as cur:
        cur.execute(sql)
        for api_id, service_id, s_alias, s_title in cur.fetchall():
            alias = derive_alias(s_alias, s_title)
            if not alias or alias in EXCLUDED_ALIASES:
                continue
            mapping[api_id] = {
                "service_id": service_id,
                "alias": alias,
                "title": s_title or "",
            }
    return mapping


def determine_status(uptime):
    if uptime >= 95.0:
        return "operational"
    if uptime >= 80.0:
        return "degraded"
    if uptime >= 50.0:
        return "partial_outage"
    return "major_outage"


def compute_overall(services):
    statuses = [s["current_status"] for s in services]
    major = sum(1 for s in statuses if s == "major_outage")
    partial = sum(1 for s in statuses if s == "partial_outage")
    degraded = sum(1 for s in statuses if s == "degraded")
    total = len(statuses)

    if total == 0:
        return "No Data"
    if major >= max(2, total * 0.2):
        return "Major System Outage"
    if major >= 1 or partial >= max(2, total * 0.2):
        return "Partial System Outage"
    if partial >= 1 or degraded >= 1:
        return "Minor Service Disruption"
    return "All Systems Operational"


# ---------------------------------------------------------------------------
# Bucketed query (1d / 7d / 30d)
# ---------------------------------------------------------------------------

def generate_bucketed(conn, days):
    bucket_minutes, num_slots, granularity_label = BUCKET_CONFIG[days]
    min_requests = MIN_REQUESTS_BY_DAYS.get(days, 3)
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(days=days)

    api_map = build_api_to_service_map(conn)
    if not api_map:
        return {"overall_status": "No Data", "granularity": granularity_label, "services": []}

    api_ids = list(api_map.keys())
    bucket_seconds = bucket_minutes * 60

    # Single aggregation query — pushed to PostgreSQL
    placeholders = ", ".join(["%s"] * len(api_ids))
    sql = f"""
        SELECT
            api_id,
            to_char(
                to_timestamp(
                    floor(extract(epoch from created_at) / %s) * %s
                ) AT TIME ZONE 'UTC',
                'YYYY-MM-DD"T"HH24:MI'
            ) AS bucket_key,
            COUNT(*) AS total,
            COUNT(*) FILTER (WHERE status_code IS NOT NULL AND status_code < 400) AS success,
            COUNT(*) FILTER (WHERE status_code >= 400 AND status_code < 500) AS client_error,
            COUNT(*) FILTER (WHERE status_code >= 500) AS server_error
        FROM app_apiusage
        WHERE created_at >= %s
          AND api_id IN ({placeholders})
        GROUP BY api_id, bucket_key
    """
    params = [bucket_seconds, bucket_seconds, cutoff] + api_ids

    with conn.cursor() as cur:
        cur.execute(sql, params)
        rows = cur.fetchall()

    # Merge per-API → per-service
    bucket_stats = defaultdict(lambda: defaultdict(lambda: {"total": 0, "success": 0, "client_error": 0, "server_error": 0}))
    service_info = {}

    for api_id, bucket_key, total, success, client_error, server_error in rows:
        if api_id not in api_map:
            continue
        svc = api_map[api_id]
        sid = svc["service_id"]
        service_info[sid] = {"alias": svc["alias"], "title": svc["title"]}

        bucket = bucket_stats[sid][bucket_key]
        bucket["total"] += total
        bucket["success"] += success
        bucket["client_error"] += client_error
        bucket["server_error"] += server_error

    # Build slot keys (UTC)
    if bucket_minutes <= 60:
        slot_base = now.replace(minute=(now.minute // bucket_minutes) * bucket_minutes, second=0, microsecond=0)
    else:
        total_min = now.hour * 60 + now.minute
        aligned_min = (total_min // bucket_minutes) * bucket_minutes
        slot_base = now.replace(hour=aligned_min // 60, minute=aligned_min % 60, second=0, microsecond=0)

    all_slot_keys = []
    for i in range(num_slots - 1, -1, -1):
        t = slot_base - timedelta(minutes=i * bucket_minutes)
        all_slot_keys.append(t.strftime("%Y-%m-%dT%H:%M"))

    # Build response
    result = []
    for sid in sorted(bucket_stats, key=lambda s: service_info.get(s, {}).get("alias", "")):
        info = service_info[sid]
        slots_data = bucket_stats[sid]

        total_all = sum(h["total"] for h in slots_data.values())
        if total_all < min_requests:
            continue

        server_errors_all = sum(h["server_error"] for h in slots_data.values())
        non_5xx = total_all - server_errors_all
        uptime_pct = round((non_5xx / total_all) * 100, 3) if total_all > 0 else 100.0

        slot_entries = []
        for slot_key in all_slot_keys:
            h = slots_data.get(slot_key)
            if h and h["total"] > 0:
                htotal = h["total"]
                hnon5xx = htotal - h["server_error"]
                huptime = round((hnon5xx / htotal) * 100, 3)
                slot_entries.append({
                    "date": slot_key,
                    "total_requests": htotal,
                    "success_count": h["success"],
                    "client_error_count": h["client_error"],
                    "server_error_count": h["server_error"],
                    "uptime": huptime,
                })
            else:
                slot_entries.append({
                    "date": slot_key,
                    "total_requests": 0,
                    "success_count": 0,
                    "client_error_count": 0,
                    "server_error_count": 0,
                    "uptime": 100.0,
                })

        recent = slot_entries[-1] if slot_entries else None
        current_status = "unknown" if recent is None else determine_status(recent["uptime"])

        result.append({
            "service_id": sid,
            "service_alias": info["alias"],
            "service_title": info["title"],
            "current_status": current_status,
            "uptime_90d": uptime_pct,
            "total_requests_90d": total_all,
            "daily": slot_entries,
        })

    return {"overall_status": compute_overall(result), "granularity": granularity_label, "services": result}


# ---------------------------------------------------------------------------
# Daily query (90d) — from pre-aggregated ServiceUptime table
# ---------------------------------------------------------------------------

def generate_daily(conn, days=90):
    min_requests = MIN_REQUESTS_BY_DAYS.get(days, 200)
    cutoff = (datetime.now(timezone.utc).date() - timedelta(days=days)).isoformat()

    sql = """
        SELECT service_id, service_alias, service_title,
               date, total_requests, success_count, client_error_count,
               server_error_count, uptime
        FROM app_serviceuptime
        WHERE date >= %s
        ORDER BY service_alias, date
    """
    with conn.cursor() as cur:
        cur.execute(sql, [cutoff])
        rows = cur.fetchall()

    # Group by service
    services = {}
    for sid, alias, title, date, total_req, success, client_err, server_err, uptime in rows:
        if sid not in services:
            services[sid] = {
                "service_id": sid,
                "service_alias": alias or sid,
                "service_title": title or "",
                "records": [],
                "total_requests": 0,
                "weighted_uptime_sum": 0.0,
            }
        svc = services[sid]
        svc["records"].append({
            "service_id": sid,
            "service_alias": alias or sid,
            "service_title": title or "",
            "date": date.isoformat() if hasattr(date, "isoformat") else str(date),
            "total_requests": total_req,
            "success_count": success,
            "client_error_count": client_err,
            "server_error_count": server_err,
            "uptime": float(uptime),
        })
        svc["total_requests"] += total_req
        svc["weighted_uptime_sum"] += float(uptime) * total_req

    # Build response
    result = []
    for sid, svc in sorted(services.items(), key=lambda x: x[1]["service_alias"]):
        alias = svc["service_alias"]
        total = svc["total_requests"]
        if total < min_requests or alias in EXCLUDED_ALIASES:
            continue

        uptime_pct = round(svc["weighted_uptime_sum"] / total, 3) if total > 0 else 100.0
        recent = svc["records"][-1] if svc["records"] else None
        current_status = "unknown" if recent is None else determine_status(recent["uptime"])

        result.append({
            "service_id": sid,
            "service_alias": alias,
            "service_title": svc["service_title"],
            "current_status": current_status,
            "uptime_90d": uptime_pct,
            "total_requests_90d": total,
            "daily": svc["records"],
        })

    return {"overall_status": compute_overall(result), "granularity": "daily", "services": result}


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    print("Connecting to database...")
    conn = get_connection()

    try:
        for days in [1, 7, 30]:
            print(f"Generating status_{days}.json (bucketed)...")
            data = generate_bucketed(conn, days)
            outpath = os.path.join(OUTPUT_DIR, f"status_{days}.json")
            with open(outpath, "w") as f:
                json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
            svc_count = len(data["services"])
            print(f"  → {svc_count} services, {os.path.getsize(outpath)} bytes")

        print("Generating status_90.json (daily)...")
        data = generate_daily(conn, 90)
        outpath = os.path.join(OUTPUT_DIR, "status_90.json")
        with open(outpath, "w") as f:
            json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
        svc_count = len(data["services"])
        print(f"  → {svc_count} services, {os.path.getsize(outpath)} bytes")

    finally:
        conn.close()

    print("Done!")


if __name__ == "__main__":
    main()

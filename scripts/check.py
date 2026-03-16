#!/usr/bin/env python3
"""
Status checker for LAAI status page.
Monitors https://esteno.io and writes status.json and history.json to public/.
"""

import json
import os
import sys
from datetime import datetime, timezone

try:
    import requests
except ImportError:
    print("Install requests: pip install requests", file=sys.stderr)
    sys.exit(1)

# Config
PUBLIC_DIR = os.path.join(os.path.dirname(__file__), "..", "public")
STATUS_FILE = os.path.join(PUBLIC_DIR, "status.json")
HISTORY_FILE = os.path.join(PUBLIC_DIR, "history.json")
TIMEOUT_SEC = 15
DEGRADED_MS = 5000
# ~10 min intervals, 7 days = 1008; keep 14 days for buffer
HISTORY_MAX_RECORDS = 2016

SERVICE_NAME = "Esteno Website"
SERVICE_URL = "https://esteno.io"


def check_url(url: str, timeout: int) -> tuple[str, int | None, float | None]:
    """
    GET url and return (status_label, http_code or None, response_time_ms or None).
    status_label: "operational" | "degraded" | "down"
    """
    try:
        start = datetime.now(timezone.utc)
        r = requests.get(url, timeout=timeout, allow_redirects=True)
        elapsed_ms = (datetime.now(timezone.utc) - start).total_seconds() * 1000
        code = r.status_code
        if 200 <= code < 400:
            if elapsed_ms < DEGRADED_MS:
                return "operational", code, round(elapsed_ms, 2)
            return "degraded", code, round(elapsed_ms, 2)
        return "down", code, round(elapsed_ms, 2)
    except requests.exceptions.Timeout:
        return "down", None, None
    except requests.exceptions.RequestException:
        return "down", None, None


def load_json(path: str, default: dict | list):
    if os.path.isfile(path):
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    return default


def save_json(path: str, data: dict | list) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)


def overall_from_statuses(statuses: list[str]) -> str:
    """Derive overall status: down > degraded > operational."""
    if "down" in statuses:
        return "down"
    if "degraded" in statuses:
        return "degraded"
    return "operational"


def trim_history(records: list, max_records: int) -> list:
    """Keep the most recent max_records."""
    if len(records) <= max_records:
        return records
    return records[-max_records:]


def main() -> None:
    status_label, http_code, response_time_ms = check_url(SERVICE_URL, TIMEOUT_SEC)
    now = datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")

    # Build current status
    status_data = {
        "updated": now,
        "overall": status_label,
        "services": [
            {
                "name": SERVICE_NAME,
                "url": SERVICE_URL,
                "status": status_label,
                "http_status": http_code,
                "response_time_ms": response_time_ms,
            }
        ],
    }
    save_json(STATUS_FILE, status_data)

    # Append to history
    history = load_json(HISTORY_FILE, [])
    history.append({
        "timestamp": now,
        "service": SERVICE_NAME,
        "status": status_label,
        "http_status": http_code,
        "response_time_ms": response_time_ms,
    })
    history = trim_history(history, HISTORY_MAX_RECORDS)
    save_json(HISTORY_FILE, history)

    # GitHub Actions output for "overall"
    print(f"overall={status_label}")


if __name__ == "__main__":
    main()

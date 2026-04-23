#!/usr/bin/env python3
"""
Status checker for LAAI status page.
Uses only the Python standard library. Monitors https://esteno.io and writes
status.json and history.json to public/.
"""

import json
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

# Config
# STATUS_JSON_PATH and HISTORY_JSON_PATH can be overridden via env vars so the
# workflow can point the script at a data-branch working tree instead of public/.
_PUBLIC_DIR = os.path.join(os.path.dirname(__file__), "..", "public")
STATUS_FILE  = os.environ.get("STATUS_JSON_PATH",  os.path.join(_PUBLIC_DIR, "status.json"))
HISTORY_FILE = os.environ.get("HISTORY_JSON_PATH", os.path.join(_PUBLIC_DIR, "history.json"))
TIMEOUT_SEC = 15
DEGRADED_MS = 5000
# Retain records newer than this many days; cadence-independent.
HISTORY_RETENTION_DAYS = 90

SERVICE_NAME = "Esteno Website"
SERVICE_URL = "https://esteno.io"


def check_url(url: str, timeout: int) -> tuple[str, int | None, float | None]:
    """
    GET url (follow redirects) and return (status_label, http_code or None, response_time_ms or None).
    status_label: "operational" | "degraded" | "down"
    """
    start = datetime.now(timezone.utc)
    req = urllib.request.Request(url, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            elapsed_ms = (datetime.now(timezone.utc) - start).total_seconds() * 1000
            code = resp.status
            if 200 <= code < 400:
                if elapsed_ms < DEGRADED_MS:
                    return "operational", code, round(elapsed_ms, 2)
                return "degraded", code, round(elapsed_ms, 2)
            return "down", code, round(elapsed_ms, 2)
    except urllib.error.HTTPError as e:
        elapsed_ms = (datetime.now(timezone.utc) - start).total_seconds() * 1000
        return "down", e.code, round(elapsed_ms, 2)
    except (urllib.error.URLError, OSError, TimeoutError) as _:
        return "down", None, None


def load_json(path: str, default: dict | list):
    """Load JSON from path, falling back to default on any error."""
    if not os.path.isfile(path):
        return default
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
            return data
    except Exception:
        return default


def save_json(path: str, data: dict | list) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)


def trim_history_by_time(records: list, now_utc: datetime, retention_days: int) -> list:
    """
    Drop records older than retention_days before now_utc.
    The cutoff is exclusive: a record timestamped exactly at
    (now_utc - retention_days) is kept.
    Records with an unparseable timestamp are kept (fail-open) and a
    warning is printed to stderr so data is never silently discarded.
    """
    # Truncate to whole seconds so the cutoff is comparable to stored timestamps,
    # which are also serialised at second precision. A record from exactly
    # (now - retention_days) is kept (>=).
    cutoff = (now_utc - timedelta(days=retention_days)).replace(microsecond=0)
    kept = []
    for r in records:
        ts_raw = r.get("timestamp") if isinstance(r, dict) else None
        if not ts_raw:
            kept.append(r)
            continue
        try:
            # fromisoformat handles both "Z" suffix (Python 3.11+) and "+00:00".
            ts_str = ts_raw.replace("Z", "+00:00")
            ts = datetime.fromisoformat(ts_str)
            if ts.tzinfo is None:
                ts = ts.replace(tzinfo=timezone.utc)
            if ts >= cutoff:
                kept.append(r)
        except (ValueError, AttributeError):
            print(f"[check.py] warning: unparseable timestamp {ts_raw!r}, keeping record", file=sys.stderr)
            kept.append(r)
    return kept


def write_overall_output(status_label: str) -> None:
    """
    Write overall status for GitHub Actions and local runs:
    - If GITHUB_OUTPUT is set, append `overall=<value>` to that file.
    - Otherwise print `overall=<value>` to stdout.
    """
    gh_output = os.environ.get("GITHUB_OUTPUT")
    line = f"overall={status_label}\n"
    if gh_output:
        try:
            with open(gh_output, "a", encoding="utf-8") as f:
                f.write(line)
        except OSError:
            sys.stdout.write(line)
    else:
        sys.stdout.write(line)


def run_check() -> str:
    """
    Perform a single check and update status/history.
    Returns the overall status label. Does not raise for normal monitoring failures.
    """
    os.makedirs(os.path.dirname(os.path.abspath(STATUS_FILE)), exist_ok=True)

    status_label, http_code, response_time_ms = check_url(SERVICE_URL, TIMEOUT_SEC)
    now = datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")

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

    history = load_json(HISTORY_FILE, [])
    if not isinstance(history, list):
        history = []
    history.append({
        "timestamp": now,
        "service": SERVICE_NAME,
        "status": status_label,
        "http_status": http_code,
        "response_time_ms": response_time_ms,
    })
    now_utc = datetime.now(timezone.utc)
    history = trim_history_by_time(history, now_utc, HISTORY_RETENTION_DAYS)
    save_json(HISTORY_FILE, history)

    return status_label


def main() -> int:
    """
    Entry point for CLI / GitHub Actions.
    Normal monitoring failures must not crash the script. Exit 0 for all normal outcomes.
    """
    overall_status = "down"

    try:
        overall_status = run_check()
    except Exception as e:
        # Truly unexpected: log once to stderr, then write down status and exit 0.
        print(f"[check.py] unexpected error: {e}", file=sys.stderr)
        now = datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
        os.makedirs(os.path.dirname(os.path.abspath(STATUS_FILE)), exist_ok=True)

        fallback_status = {
            "updated": now,
            "overall": "down",
            "services": [
                {
                    "name": SERVICE_NAME,
                    "url": SERVICE_URL,
                    "status": "down",
                    "http_status": None,
                    "response_time_ms": None,
                }
            ],
        }
        try:
            save_json(STATUS_FILE, fallback_status)
        except Exception:
            pass

        try:
            history = load_json(HISTORY_FILE, [])
            if not isinstance(history, list):
                history = []
            history.append({
                "timestamp": now,
                "service": SERVICE_NAME,
                "status": "down",
                "http_status": None,
                "response_time_ms": None,
            })
            history = trim_history_by_time(history, datetime.now(timezone.utc), HISTORY_RETENTION_DAYS)
            save_json(HISTORY_FILE, history)
        except Exception:
            pass

    write_overall_output(overall_status)
    return 0


if __name__ == "__main__":
    sys.exit(main())

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
    # Fundamental problem: dependency is missing. Fail fast so the workflow
    # can be fixed instead of silently reporting incorrect status.
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
    """Load JSON from path, falling back to default on any error."""
    if not os.path.isfile(path):
        return default
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        # Malformed or unreadable JSON; caller will decide how to handle.
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
            # Fall back to stdout if we cannot write to the file.
            sys.stdout.write(line)
    else:
        sys.stdout.write(line)


def run_check() -> str:
    """
    Perform a single check and update status/history.

    Returns the overall status label so callers can decide what to do,
    but this function is expected to succeed (not raise) for normal
    monitoring failures like timeouts, HTTP errors, etc.
    """
    # Ensure public directory exists up front.
    os.makedirs(PUBLIC_DIR, exist_ok=True)

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

    # Append to history (defensive against malformed/empty JSON)
    history = load_json(HISTORY_FILE, [])
    if not isinstance(history, list):
        history = []
    history.append(
        {
            "timestamp": now,
            "service": SERVICE_NAME,
            "status": status_label,
            "http_status": http_code,
            "response_time_ms": response_time_ms,
        }
    )
    history = trim_history(history, HISTORY_MAX_RECORDS)
    save_json(HISTORY_FILE, history)

    return status_label


def main() -> int:
    """
    Entry point for CLI / GitHub Actions.

    Normal monitoring failures (timeouts, HTTP 4xx/5xx, DNS/TLS errors)
    must not crash the script. Unexpected exceptions are caught and
    treated as a `down` status while still attempting to write valid
    status/history if possible.
    """
    overall_status = "down"

    try:
        overall_status = run_check()
    except Exception:
        # Unexpected failure: best-effort write of a `down` status record
        # so the page stays valid instead of breaking entirely.
        now = datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")

        # Ensure public directory exists.
        os.makedirs(PUBLIC_DIR, exist_ok=True)

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
            # If even writing status fails, there's not much else we can do.
            pass

        # Try to append a history row with `down` status using the same schema.
        try:
            history = load_json(HISTORY_FILE, [])
            if not isinstance(history, list):
                history = []
            history.append(
                {
                    "timestamp": now,
                    "service": SERVICE_NAME,
                    "status": "down",
                    "http_status": None,
                    "response_time_ms": None,
                }
            )
            history = trim_history(history, HISTORY_MAX_RECORDS)
            save_json(HISTORY_FILE, history)
        except Exception:
            # Ignore history write failures; status.json is enough to keep UI valid.
            pass

    # Always try to write the overall output, even if we had to fall back to `down`.
    write_overall_output(overall_status)

    # Exit code 0 for all normal monitoring paths; only fundamental issues
    # like a missing `requests` dependency cause a non-zero exit earlier.
    return 0


if __name__ == "__main__":
    sys.exit(main())

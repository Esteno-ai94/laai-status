# LAAI Status Page

Minimal production-ready status page for [esteno.io](https://esteno.io), hosted on GitHub Pages and updated by GitHub Actions every 10 minutes.

## What it does

- **Monitor**: A Python script checks https://esteno.io every 10 minutes (via cron and manual dispatch).
- **Classification**:
  - **Operational** — HTTP 2xx/3xx and response time &lt; 5 s
  - **Degraded** — HTTP 2xx/3xx and response time ≥ 5 s
  - **Down** — Timeout (15 s), network error, or HTTP 4xx/5xx
- **Output**: Writes `public/status.json` (current status) and `public/history.json` (time-series for uptime and incidents).
- **Deploy**: Workflow commits updated JSON (when changed), uploads the `public/` directory as the Pages artifact, and deploys to GitHub Pages.

## Repo layout

```
.github/workflows/monitor.yml   # Cron + workflow_dispatch; run checker, commit, deploy
public/
  index.html                    # Status page UI
  styles.css
  app.js
  status.json                   # Current status (generated)
  history.json                  # History records (generated)
scripts/
  check.py                      # Single endpoint checker
README.md
```

## Setup

1. **GitHub Pages**: In the repo **Settings → Pages**, set “Build and deployment” to **GitHub Actions** (not “Deploy from a branch”).
2. **Permissions**: The workflow uses `contents: write` (to commit updated JSON) and `pages: write` (to deploy). No extra secrets are required.
3. **First run**: Trigger **Actions → Monitor and Deploy → Run workflow**, or wait for the first cron run.

## Local check

```bash
pip install requests
python scripts/check.py
# Writes/updates public/status.json and public/history.json; prints overall=… for GITHUB_OUTPUT.
```

## UI

The page shows:

- **Overall status** (operational / degraded / down)
- **Last checked** (timestamp)
- **Uptime** — Last 24 hours and last 7 days (from `history.json`)
- **Services** — Card for “Esteno Website” with status, HTTP code, response time
- **Recent incidents** — Table of recent history rows (non‑operational rows highlighted)

Plain HTML/CSS/JS only; no framework or build step.

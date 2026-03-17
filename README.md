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
# Writes/updates public/status.json and public/history.json; prints overall=… for local runs.
```

## Troubleshooting

- **Checker exits with code 1 in GitHub Actions**  
  - The script only exits non‑zero when it is fundamentally broken (for example, `requests` is not installed).  
  - Verify the workflow step `pip install --no-deps requests` runs before `python scripts/check.py`.  
  - For normal monitoring issues (timeouts, HTTP 4xx/5xx, DNS/TLS errors) the script still exits 0 and reports `overall=down`.

- **Malformed or unreadable JSON in `public/status.json` or `public/history.json`**  
  - The checker defensively treats unreadable JSON as empty and rewrites valid files on the next run.  
  - If you want to reset manually, you can delete `public/status.json` and `public/history.json`; the next checker run will recreate them.

- **Missing `public/` directory**  
  - The checker creates `public/` and the JSON files on each run if they do not exist.  
  - You do not need to create the directory yourself for GitHub Actions; it is handled by the script.

- **Local testing**  
  - Run:
    ```bash
    pip install requests
    python scripts/check.py
    ```
  - Check `public/status.json` and `public/history.json` to confirm that new entries were written and that `overall=<value>` was printed to the terminal.

## UI

The page shows:

- **Overall status** (operational / degraded / down)
- **Last checked** (timestamp)
- **Uptime** — Last 24 hours and last 7 days (from `history.json`)
- **Services** — Card for “Esteno Website” with status, HTTP code, response time
- **Recent incidents** — Table of recent history rows (non‑operational rows highlighted)

Plain HTML/CSS/JS only; no framework or build step.

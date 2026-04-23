/**
 * LAAI Status Page — renders status.json and history.json.
 * Plain vanilla JS, no framework, no build step.
 */
(function () {
  'use strict';

  // ── Constants ─────────────────────────────────────────────────
  var DAYS_90      = 90;
  var RECENT_ROWS  = 50;
  var MS_DAY       = 86400000;

  // ── Helpers ───────────────────────────────────────────────────
  function el(id) { return document.getElementById(id); }

  function escapeHtml(s) {
    if (s == null) return '';
    var d = document.createElement('div');
    d.textContent = String(s);
    return d.innerHTML;
  }

  /** YYYY-MM-DD in UTC for a given Date (or timestamp string). */
  function toDateKey(ts) {
    try {
      var d = new Date(ts);
      return d.toISOString().slice(0, 10);
    } catch (_) { return null; }
  }

  /** Return the UTC date-key for `daysAgo` days before today. */
  function dateKeyDaysAgo(daysAgo) {
    var d = new Date(Date.now() - daysAgo * MS_DAY);
    return d.toISOString().slice(0, 10);
  }

  /** Format a date key as "Apr 3" etc. */
  function fmtDateKey(key) {
    try {
      var d = new Date(key + 'T12:00:00Z');
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
    } catch (_) { return key; }
  }

  /**
   * Aggregate history records into a map keyed by YYYY-MM-DD.
   * Each value: { checks: number, operational: number, worst: string }
   * worst follows down > degraded > operational.
   */
  function aggregateByDay(history) {
    var map = {};
    var priority = { operational: 0, degraded: 1, down: 2 };

    history.forEach(function (r) {
      var key = toDateKey(r.timestamp);
      if (!key) return;
      if (!map[key]) map[key] = { checks: 0, operational: 0, worst: 'operational' };
      var entry = map[key];
      entry.checks += 1;
      if (r.status === 'operational') entry.operational += 1;
      if ((priority[r.status] || 0) > (priority[entry.worst] || 0)) {
        entry.worst = r.status;
      }
    });

    return map;
  }

  /**
   * Build the ordered 90-day slot array (oldest first → today).
   * Each slot: { key: 'YYYY-MM-DD', status: string, checks: number, pct: number|null }
   */
  function build90DaySlots(dayMap) {
    var slots = [];
    for (var i = DAYS_90 - 1; i >= 0; i--) {
      var key = dateKeyDaysAgo(i);
      var entry = dayMap[key];
      var slot;
      if (entry && entry.checks > 0) {
        var pct = Math.round((entry.operational / entry.checks) * 1000) / 10;
        slot = { key: key, status: entry.worst, checks: entry.checks, pct: pct };
      } else {
        slot = { key: key, status: 'empty', checks: 0, pct: null };
      }
      slots.push(slot);
    }
    return slots;
  }

  /**
   * Compute uptime % over the last N days from raw history.
   * Returns null when no records exist in that period.
   */
  function uptimePct(history, days) {
    var since = Date.now() - days * MS_DAY;
    var inWindow = history.filter(function (r) {
      try { return new Date(r.timestamp).getTime() >= since; } catch (_) { return false; }
    });
    if (!inWindow.length) return null;
    var ok = inWindow.filter(function (r) { return r.status === 'operational'; }).length;
    return Math.round((ok / inWindow.length) * 1000) / 10;
  }

  // ── Tooltip ───────────────────────────────────────────────────
  var tooltip = el('bar-tooltip');

  function showTooltip(slot, evt) {
    if (!tooltip) return;
    var label = fmtDateKey(slot.key);
    var detail;
    if (slot.status === 'empty') {
      detail = 'No data';
    } else {
      var pctStr = slot.pct != null ? slot.pct + '%' : '—';
      var statusStr = slot.status.charAt(0).toUpperCase() + slot.status.slice(1);
      detail = statusStr + ' &middot; ' + pctStr + ' uptime (' + slot.checks + ' checks)';
    }
    tooltip.innerHTML = '<strong>' + escapeHtml(label) + '</strong><br>' + detail;
    positionTooltip(evt);
    tooltip.setAttribute('aria-hidden', 'false');
    tooltip.classList.add('visible');
  }

  function hideTooltip() {
    if (!tooltip) return;
    tooltip.classList.remove('visible');
    tooltip.setAttribute('aria-hidden', 'true');
  }

  function positionTooltip(evt) {
    if (!tooltip) return;
    var x = evt.clientX + 12;
    var y = evt.clientY - 36;
    // Keep within viewport
    var tw = tooltip.offsetWidth || 160;
    if (x + tw > window.innerWidth - 8) x = evt.clientX - tw - 12;
    if (y < 4) y = evt.clientY + 16;
    tooltip.style.left = x + 'px';
    tooltip.style.top  = y + 'px';
  }

  // ── Renderers ─────────────────────────────────────────────────

  /** Update the hero card with overall status. */
  function renderHero(status, updated) {
    var card  = el('hero-card');
    var label = el('hero-label');
    var meta  = el('last-checked');

    var labels = {
      operational: 'All Systems Operational',
      degraded:    'Degraded Performance',
      down:        'Service Disruption',
    };

    if (card) {
      card.className = 'hero-card ' + (status || '');
    }
    if (label) {
      label.textContent = labels[status] || 'Status Unknown';
    }
    if (meta && updated) {
      try {
        var d = new Date(updated);
        meta.textContent = 'Last checked: ' + d.toLocaleString('en-US', {
          month: 'short', day: 'numeric', year: 'numeric',
          hour: '2-digit', minute: '2-digit', timeZone: 'UTC'
        }) + ' UTC';
      } catch (_) {
        meta.textContent = 'Last checked: ' + updated;
      }
    }

    // Footer timestamp mirrors hero meta
    var fts = el('footer-ts');
    if (fts && updated) {
      try {
        fts.textContent = new Date(updated).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
      } catch (_) { fts.textContent = updated; }
    }
  }

  /** Render the 90-day uptime bar section for all services. */
  function renderUptimeBars(history) {
    var container = el('uptime-bars');
    var pct90el   = el('uptime-90d');
    if (!container) return;

    // Collect unique service names from history (preserve insertion order)
    var services = [];
    var seen = {};
    history.forEach(function (r) {
      if (r.service && !seen[r.service]) {
        seen[r.service] = true;
        services.push(r.service);
      }
    });
    // Fallback: no history yet
    if (!services.length) services = ['Esteno Website'];

    // Overall 90-day uptime across all records
    var overall = uptimePct(history, DAYS_90);
    if (pct90el) {
      pct90el.textContent = overall != null ? overall + '%' : '—';
    }

    var html = '';

    services.forEach(function (svcName) {
      var svcHistory = history.filter(function (r) { return r.service === svcName; });
      var dayMap = aggregateByDay(svcHistory);
      var slots  = build90DaySlots(dayMap);
      var pct    = uptimePct(svcHistory, DAYS_90);
      var pctStr = pct != null ? pct + '%' : '—';

      // Build bars HTML
      var barsHtml = slots.map(function (slot, idx) {
        var ariaLabel = fmtDateKey(slot.key) + ': ' +
          (slot.status === 'empty' ? 'no data' : slot.status +
            (slot.pct != null ? ', ' + slot.pct + '% uptime' : ''));
        return (
          '<span class="bar ' + slot.status + '"' +
          ' role="img"' +
          ' aria-label="' + escapeHtml(ariaLabel) + '"' +
          ' tabindex="0"' +
          ' data-idx="' + idx + '">' +
          '</span>'
        );
      }).join('');

      html += (
        '<div class="uptime-row">' +
          '<div class="uptime-row-header">' +
            '<span class="uptime-row-name">' + escapeHtml(svcName) + '</span>' +
            '<span class="uptime-row-pct">' + escapeHtml(pctStr) + ' uptime</span>' +
          '</div>' +
          '<div class="bar-track" data-service="' + escapeHtml(svcName) + '">' +
            barsHtml +
          '</div>' +
          '<div class="bar-track-labels">' +
            '<span>' + escapeHtml(fmtDateKey(slots[0].key)) + '</span>' +
            '<span>Today</span>' +
          '</div>' +
        '</div>'
      );
    });

    container.innerHTML = html;

    // Wire tooltip events (one listener per bar-track via delegation)
    var tracks = container.querySelectorAll('.bar-track');
    tracks.forEach(function (track) {
      var svcName = track.getAttribute('data-service');
      var svcHistory = history.filter(function (r) { return r.service === svcName; });
      var dayMap = aggregateByDay(svcHistory);
      var slots  = build90DaySlots(dayMap);

      track.addEventListener('mousemove', function (evt) {
        var bar = evt.target.closest('.bar');
        if (!bar) return;
        var idx = parseInt(bar.getAttribute('data-idx'), 10);
        if (!isNaN(idx)) { showTooltip(slots[idx], evt); positionTooltip(evt); }
      });
      track.addEventListener('mouseleave', hideTooltip);

      // Keyboard: show tooltip on focus, hide on blur
      track.addEventListener('focusin', function (evt) {
        var bar = evt.target;
        if (!bar.classList.contains('bar')) return;
        var idx = parseInt(bar.getAttribute('data-idx'), 10);
        if (!isNaN(idx)) {
          var rect = bar.getBoundingClientRect();
          showTooltip(slots[idx], { clientX: rect.left + rect.width / 2, clientY: rect.top });
        }
      });
      track.addEventListener('focusout', hideTooltip);
    });
  }

  /** Render the services cards. */
  function renderServices(services) {
    var list = el('services-list');
    if (!list) return;
    if (!services || !services.length) {
      list.innerHTML = '<p style="color:var(--text-muted);font-size:.9rem">No services configured.</p>';
      return;
    }

    list.innerHTML = services.map(function (s) {
      var meta = [];
      if (s.http_status != null) meta.push('HTTP ' + s.http_status);
      if (s.response_time_ms != null) meta.push(s.response_time_ms + ' ms');

      return (
        '<div class="service-card">' +
          '<div>' +
            '<div class="service-name">' + escapeHtml(s.name) + '</div>' +
            (s.url
              ? '<div class="service-url"><a href="' + escapeHtml(s.url) + '" target="_blank" rel="noopener">' + escapeHtml(s.url) + '</a></div>'
              : '') +
          '</div>' +
          '<div class="service-right">' +
            (meta.length ? '<span class="service-meta">' + escapeHtml(meta.join(' · ')) + '</span>' : '') +
            '<span class="status-pill ' + escapeHtml(s.status || '') + '">' +
              escapeHtml(s.status || '—') +
            '</span>' +
          '</div>' +
        '</div>'
      );
    }).join('');
  }

  /** Render the recent-checks table (most recent first). */
  function renderChecks(history) {
    var tbody = el('checks-body');
    if (!tbody) return;
    if (!history || !history.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="td-muted">No data yet.</td></tr>';
      return;
    }

    var recent = history.slice(-RECENT_ROWS).reverse();

    tbody.innerHTML = recent.map(function (r) {
      var time = '—';
      try {
        time = new Date(r.timestamp).toISOString().replace('T', ' ').slice(0, 19);
      } catch (_) {
        time = r.timestamp || '—';
      }

      var rowClass = r.status === 'down' ? 'row-down'
        : r.status === 'degraded'        ? 'row-degraded'
        : r.status === 'operational'     ? 'row-operational'
        : '';

      return (
        '<tr class="' + rowClass + '">' +
          '<td class="td-muted">' + escapeHtml(time) + '</td>' +
          '<td>' + escapeHtml(r.service || '—') + '</td>' +
          '<td class="td-status">' + escapeHtml(r.status || '—') + '</td>' +
          '<td class="num td-muted">' + (r.http_status != null ? escapeHtml(String(r.http_status)) : '—') + '</td>' +
          '<td class="num td-muted">' + (r.response_time_ms != null ? escapeHtml(String(r.response_time_ms)) + ' ms' : '—') + '</td>' +
        '</tr>'
      );
    }).join('');
  }

  // ── Fetch & render ────────────────────────────────────────────
  function load(url) {
    return fetch(url).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    });
  }

  function run() {
    Promise.all([load('status.json'), load('history.json')])
      .then(function (results) {
        var status  = results[0];
        var history = Array.isArray(results[1]) ? results[1] : [];

        renderHero(status.overall, status.updated);
        renderUptimeBars(history);
        renderServices(status.services || []);
        renderChecks(history);
      })
      .catch(function (err) {
        var card = el('hero-card');
        if (card) {
          card.className = 'hero-card down';
          var lbl = el('hero-label');
          if (lbl) lbl.textContent = 'Unable to load status';
        }
        var tbody = el('checks-body');
        if (tbody) tbody.innerHTML = '<tr><td colspan="5" class="td-muted">Failed to load data.</td></tr>';
        console.error('[status page]', err);
      });
  }

  run();
})();

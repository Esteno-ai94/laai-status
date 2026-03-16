/**
 * LAAI Status Page — loads status.json and history.json and renders the UI.
 */

(function () {
  const MS_24H = 24 * 60 * 60 * 1000;
  const MS_7D = 7 * 24 * 60 * 60 * 1000;
  const RECENT_ROWS = 50;

  function el(id) {
    return document.getElementById(id);
  }

  function setOverall(status) {
    const badge = el('overall-badge');
    if (!badge) return;
    badge.textContent = status || '—';
    badge.className = 'badge ' + (status === 'operational' || status === 'degraded' || status === 'down' ? status : '');
  }

  function setLastChecked(updated) {
    const node = el('last-checked');
    if (!node) return;
    if (!updated) {
      node.textContent = 'Last checked: —';
      return;
    }
    try {
      const d = new Date(updated);
      node.textContent = 'Last checked: ' + d.toLocaleString(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'UTC'
      }) + ' UTC';
    } catch (_) {
      node.textContent = 'Last checked: ' + updated;
    }
  }

  function uptimePercent(records, sinceMs) {
    const since = Date.now() - sinceMs;
    const inPeriod = records.filter(function (r) {
      try {
        return new Date(r.timestamp).getTime() >= since;
      } catch (_) {
        return false;
      }
    });
    if (inPeriod.length === 0) return null;
    const operational = inPeriod.filter(function (r) { return r.status === 'operational'; }).length;
    return Math.round((operational / inPeriod.length) * 1000) / 10;
  }

  function renderServices(services) {
    const list = el('services-list');
    if (!list) return;
    if (!services || !services.length) {
      list.innerHTML = '<p class="text-muted">No services.</p>';
      return;
    }
    list.innerHTML = services.map(function (s) {
      const meta = [];
      if (s.http_status != null) meta.push('HTTP ' + s.http_status);
      if (s.response_time_ms != null) meta.push(s.response_time_ms + ' ms');
      return (
        '<div class="service-card">' +
          '<div><span class="name">' + escapeHtml(s.name) + '</span>' +
          (s.url ? ' <a href="' + escapeHtml(s.url) + '" target="_blank" rel="noopener">' + escapeHtml(s.url) + '</a>' : '') + '</div>' +
          '<div>' +
            '<span class="status ' + (s.status || '') + '">' + escapeHtml(s.status || '—') + '</span>' +
            (meta.length ? ' <span class="meta">' + escapeHtml(meta.join(' · ')) + '</span>' : '') +
          '</div>' +
        '</div>'
      );
    }).join('');
  }

  function escapeHtml(s) {
    if (s == null) return '';
    var div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  function renderIncidents(history) {
    const tbody = el('incidents-body');
    if (!tbody) return;
    if (!history || !history.length) {
      tbody.innerHTML = '<tr><td colspan="5">No recent data.</td></tr>';
      return;
    }
    const recent = history.slice(-RECENT_ROWS).reverse();
    tbody.innerHTML = recent.map(function (r) {
      const time = (function () {
        try {
          return new Date(r.timestamp).toISOString().replace('T', ' ').slice(0, 19);
        } catch (_) {
          return r.timestamp || '—';
        }
      })();
      const rowClass = r.status === 'down' ? 'incident-down' : r.status === 'degraded' ? 'incident-degraded' : '';
      return (
        '<tr class="' + rowClass + '">' +
          '<td>' + escapeHtml(time) + '</td>' +
          '<td>' + escapeHtml(r.service || '—') + '</td>' +
          '<td>' + escapeHtml(r.status || '—') + '</td>' +
          '<td>' + (r.http_status != null ? escapeHtml(String(r.http_status)) : '—') + '</td>' +
          '<td>' + (r.response_time_ms != null ? escapeHtml(String(r.response_time_ms)) + ' ms' : '—') + '</td>' +
        '</tr>'
      );
    }).join('');
  }

  function load(url) {
    return fetch(url).then(function (res) {
      if (!res.ok) throw new Error(res.status);
      return res.json();
    });
  }

  function run() {
    Promise.all([
      load('status.json'),
      load('history.json')
    ]).then(function (results) {
      var status = results[0];
      var history = results[1];

      setOverall(status.overall);
      setLastChecked(status.updated);
      renderServices(status.services || []);

      var h = Array.isArray(history) ? history : [];
      var u24 = uptimePercent(h, MS_24H);
      var u7 = uptimePercent(h, MS_7D);
      el('uptime-24h').textContent = u24 != null ? u24 + '%' : '—';
      el('uptime-7d').textContent = u7 != null ? u7 + '%' : '—';

      renderIncidents(h);
    }).catch(function (err) {
      setOverall('unknown');
      el('uptime-24h').textContent = '—';
      el('uptime-7d').textContent = '—';
      el('incidents-body').innerHTML = '<tr><td colspan="5">Failed to load data.</td></tr>';
      console.error(err);
    });
  }

  run();
})();

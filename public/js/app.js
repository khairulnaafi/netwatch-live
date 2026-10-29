/* NetWatch Live — dashboard client */
(function () {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const nf = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 1 });
  const nf2 = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 });
  const COLORS = ['#22d3ee', '#a78bfa', '#34d399', '#fbbf24', '#fb7185', '#60a5fa'];
  const TYPE_ICON = {
    router: 'i-router', switch: 'i-switch', ap: 'i-ap', server: 'i-server',
    printer: 'i-printer', cctv: 'i-cctv', voip: 'i-voip', iot: 'i-iot',
    cloud: 'i-cloud', device: 'i-server',
  };
  const PAGE_META = {
    overview: ['Ringkasan Jaringan', 'Pantauan langsung perangkat, trafik, dan kualitas koneksi.'],
    wifi: ['Wi-Fi & Klien', 'Pantau jaringan sekitar dan perangkat yang terhubung.'],
    activity: ['Aktivitas DNS', 'Lihat domain yang diakses perangkat di jaringan Anda.'],
    alerts: ['Notifikasi', 'Atur alert Telegram, WhatsApp, dan ambang batas.'],
  };

  const state = {
    snap: null,
    page: 'overview',
    filter: 'all',
    search: '',
    offset: 0,
    firstSnapshot: true,
    seenEvents: new Set(),
    selectedDevice: null,
    configLoaded: false,
    charts: { traffic: null, latency: null, drawer: null },
    sparks: { online: [], traffic: [], latency: [] },
    sse: null,
    sseRetry: null,
    pollTimer: null,
    busy: false,
  };


  /* ------------------------------------------------------------------ */
  /* Utilities                                                           */
  /* ------------------------------------------------------------------ */

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function fmtNum(value, digits = 1) {
    if (value == null || !Number.isFinite(Number(value))) return '—';
    return (digits === 2 ? nf2 : nf).format(Number(value));
  }

  function fmtMbps(value) {
    if (value == null || !Number.isFinite(Number(value))) return '—';
    const v = Number(value);
    if (v >= 1000) return `${fmtNum(v / 1000, 2)} Gbps`;
    return `${fmtNum(v, v < 10 ? 2 : 1)} Mbps`;
  }

  function fmtMs(value) {
    if (value == null || !Number.isFinite(Number(value))) return '—';
    return `${fmtNum(value, Number(value) < 10 ? 1 : 0)} ms`;
  }

  function fmtTime(ts) {
    if (!ts) return '—';
    const d = new Date(ts);
    return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':');
  }

  function fmtAgo(ts) {
    if (!ts) return '—';
    const sec = Math.max(0, Math.round((Date.now() + state.offset - ts) / 1000));
    if (sec < 5) return 'baru saja';
    if (sec < 60) return `${sec} dtk lalu`;
    if (sec < 3600) return `${Math.floor(sec / 60)} mnt lalu`;
    return `${Math.floor(sec / 3600)} jam lalu`;
  }

  function fmtUptime(sec) {
    if (sec == null) return '—';
    const d = Math.floor(sec / 86400);
    const h = Math.floor((sec % 86400) / 3600);
    const m = Math.floor((sec % 3600) / 60);
    if (d) return `${d}h ${h}j`;
    if (h) return `${h}j ${m}m`;
    return `${m}m`;
  }

  function statusText(status) {
    return { up: 'Online', warning: 'Warning', down: 'Offline', unknown: 'Unknown' }[status] || 'Unknown';
  }

  function securityLabel(auth, cipher) {
    const text = `${auth || ''} ${cipher || ''}`;
    if (/open|terbuka|none|tidak ada/i.test(text)) return 'Terbuka';
    if (/wpa3/i.test(text)) return 'WPA3';
    if (/wpa2/i.test(text)) return 'WPA2';
    return 'WPA';
  }

  function signalBars(signal) {
    const value = Number(signal) || 0;
    const level = value >= 75 ? 4 : value >= 50 ? 3 : value >= 25 ? 2 : 1;
    const cls = value >= 60 ? '' : value >= 35 ? 'med' : 'low';
    return `<span class="signal-bars ${cls}">${[0, 1, 2, 3]
      .map((i) => `<i class="${i < level ? 'on' : ''}"></i>`)
      .join('')}</span>`;
  }

  function typeIcon(type) {
    return TYPE_ICON[type] || TYPE_ICON.device;
  }

  function initials(name) {
    const parts = String(name || '?').replace(/[^a-zA-Z0-9 ]/g, ' ').trim().split(/\s+/);
    return `${parts[0] ? parts[0][0] : '?'}${parts[1] ? parts[1][0] : ''}`.toUpperCase();
  }

  function setBusy(btn, busy, label) {
    if (!btn) return;
    if (busy) {
      if (!btn.dataset.original) btn.dataset.original = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = `<span>${esc(label || 'Memproses…')}</span>`;
    } else {
      btn.disabled = false;
      if (btn.dataset.original) {
        btn.innerHTML = btn.dataset.original;
        delete btn.dataset.original;
      }
    }
  }

  function toast(level, title, message, timeout = 5200) {
    const stack = $('#toasts');
    if (!stack) return;
    const icon = level === 'critical' || level === 'warning' ? 'i-alert' : level === 'success' ? 'i-check' : 'i-activity';
    const el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = `<div class="toast-icon ${esc(level)}"><svg><use href="#${icon}"/></svg></div>
      <div class="toast-body"><strong>${esc(title)}</strong><span>${esc(message)}</span></div>`;
    stack.appendChild(el);
    while (stack.children.length > 4) stack.firstElementChild.remove();
    setTimeout(() => {
      el.classList.add('out');
      setTimeout(() => el.remove(), 240);
    }, timeout);
  }

  async function api(path, body) {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  async function refreshState() {
    try {
      const res = await fetch('/api/state', { cache: 'no-store' });
      if (res.ok) applySnapshot(await res.json());
    } catch (_) {}
  }

  /* ------------------------------------------------------------------ */
  /* Charts                                                              */
  /* ------------------------------------------------------------------ */

  function initCharts() {
    state.charts.traffic = new NWCharts.LineChart($('#trafficChart'), {
      yFormat: (v) => (v >= 1000 ? `${fmtNum(v / 1000, 1)}G` : `${Math.round(v)}`),
      tooltipFormat: (s, v) => fmtMbps(v),
      fill: true,
    });
    state.charts.latency = new NWCharts.LineChart($('#latencyChart'), {
      yFormat: (v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : `${Math.round(v)}`),
      tooltipFormat: (s, v) => fmtMs(v),
      fill: false,
    });
  }

  function drawSpark(id, values, color) {
    const canvas = $(id);
    if (canvas) NWCharts.sparkline(canvas, values, color);
  }

  /* ------------------------------------------------------------------ */
  /* Snapshot                                                            */
  /* ------------------------------------------------------------------ */

  function applySnapshot(snap) {
    state.snap = snap;
    state.offset = snap.serverTime - Date.now();
    document.body.dataset.mode = snap.mode;

    const seeded = state.sparks.traffic.length === 0;
    if (seeded && Array.isArray(snap.traffic) && snap.traffic.length) {
      const points = snap.traffic.slice(-40);
      state.sparks.traffic = points.map((p) => (p.down || 0) + (p.up || 0));
      state.sparks.online = points.map(() => snap.kpi.online);
      state.sparks.latency = points.map(() => snap.kpi.avgLatency || 0);
    } else {
      state.sparks.online.push(snap.kpi.online);
      state.sparks.traffic.push((snap.kpi.down || 0) + (snap.kpi.up || 0));
      state.sparks.latency.push(snap.kpi.avgLatency || 0);
    }
    for (const key of Object.keys(state.sparks)) {
      if (state.sparks[key].length > 40) state.sparks[key].shift();
    }

    renderSidebar();
    renderKpis();
    renderTraffic();
    renderLatency();
    renderWifiCard();
    renderEvents();
    renderDevices();
    renderWifiPage();
    renderActivity();
    renderAlerts();
    if (state.selectedDevice) renderDrawer(state.selectedDevice);

    if (!state.configLoaded) {
      populateConfig(snap.config);
      state.configLoaded = true;
    }

    handleEventToasts(snap);
    state.firstSnapshot = false;
  }

  function handleEventToasts(snap) {
    const events = snap.events || [];
    if (state.firstSnapshot) {
      events.forEach((e) => state.seenEvents.add(e.id));
      return;
    }
    const fresh = events
      .filter((e) => !state.seenEvents.has(e.id))
      .filter((e) => Date.now() + state.offset - e.t < 90000)
      .slice(0, 2);
    events.forEach((e) => state.seenEvents.add(e.id));
    if (state.seenEvents.size > 400) state.seenEvents = new Set(events.map((e) => e.id));
    fresh.forEach((e) => {
      toast(e.level, e.title, e.deviceName ? `${e.deviceName} — ${e.message}` : e.message);
    });
  }

  /* ------------------------------------------------------------------ */
  /* Sidebar & KPI                                                       */
  /* ------------------------------------------------------------------ */

  function renderSidebar() {
    const { snap } = state;
    const demo = snap.mode === 'demo';
    $('#sideModeLabel').textContent = demo ? 'Mode Demo' : 'Mode Live';
    $('#sideModeDesc').textContent = demo
      ? 'Data simulasi realistis untuk presentasi dan uji alert.'
      : 'Ping ICMP & trafik NIC nyata dari komputer ini.';
    $('#sideModeDot').className = `pulse-dot ${demo ? 'amber' : ''}`;
    $('#sideMeter').style.width = `${Math.max(0, Math.min(100, snap.kpi.availability))}%`;
    $('#sideSystem').textContent = `${snap.system.hostname} · ${snap.system.platform.split(' ')[0]}`;
    $('#footUptime').textContent = `up ${fmtUptime(snap.system.uptimeSec)}`;
    $('#navClientCount').textContent = snap.clients.count || 0;
    $('#navAlertDot').classList.toggle('hidden', snap.kpi.offline === 0);
    $$('.mode-switch button').forEach((btn) => btn.classList.toggle('active', btn.dataset.mode === snap.mode));
    $('#incidentBtn').classList.toggle('hidden', snap.mode !== 'demo');
  }

  function renderKpis() {
    const { snap } = state;
    const k = snap.kpi;
    $('#kpiOnline').textContent = k.online;
    $('#kpiTotal').textContent = `/ ${k.total}`;
    $('#kpiOffline').textContent = k.offline > 0 ? `${k.offline} offline` : 'semua merespons';
    const onlineChip = $('#kpiOnlineChip');
    onlineChip.textContent = k.offline > 0 ? `${k.offline} offline` : 'stabil';
    onlineChip.className = `trend-chip ${k.offline > 0 ? 'bad' : 'ok'}`;

    const totalMbps = (k.down || 0) + (k.up || 0);
    $('#kpiThroughput').textContent = fmtNum(totalMbps, totalMbps < 10 ? 2 : 1);
    $('#kpiDown').textContent = fmtNum(k.down, 1);
    $('#kpiUp').textContent = fmtNum(k.up, 1);
    $('#legendDown').textContent = fmtMbps(k.down);
    $('#legendUp').textContent = fmtMbps(k.up);

    $('#kpiLatency').textContent = k.avgLatency == null ? '—' : fmtNum(k.avgLatency, 1);
    $('#kpiLoss').textContent = `loss ${fmtNum(k.avgLoss, 1)}%`;
    const latencyChip = $('#kpiLatencyChip');
    const threshold = snap.config.thresholds.latencyMs;
    if (k.avgLatency != null && k.avgLatency > threshold) {
      latencyChip.textContent = 'tinggi';
      latencyChip.className = 'trend-chip warn';
    } else if (k.warning > 0) {
      latencyChip.textContent = `${k.warning} warning`;
      latencyChip.className = 'trend-chip warn';
    } else {
      latencyChip.textContent = 'normal';
      latencyChip.className = 'trend-chip ok';
    }

    $('#kpiAvailability').textContent = fmtNum(k.availability, 2);
    $('#kpiAvailBar').style.width = `${Math.max(0, Math.min(100, k.availability))}%`;
    $('#kpiAvailSub').textContent = `${k.total} perangkat dipantau`;
    $('#kpiAvailChip').textContent = snap.mode === 'demo' ? 'demo' : 'sesi ini';

    drawSpark('#sparkOnline', state.sparks.online, '#22d3ee');
    drawSpark('#sparkTraffic', state.sparks.traffic, '#a78bfa');
    drawSpark('#sparkLatency', state.sparks.latency, '#fbbf24');

    const banner = $('#alertBanner');
    if (k.offline > 0) {
      banner.classList.remove('hidden');
      const offline = snap.devices.filter((d) => d.status === 'down');
      $('#bannerTitle').textContent = `${k.offline} perangkat offline`;
      $('#bannerMessage').textContent = offline.slice(0, 3).map((d) => d.name).join(', ') + (offline.length > 3 ? `, +${offline.length - 3} lainnya` : '') + '.';
    } else {
      banner.classList.add('hidden');
    }

    const eventsCount = snap.events.length;
    $('#eventCount').textContent = eventsCount;
  }

  function renderTraffic() {
    const { snap } = state;
    const data = snap.traffic || [];
    const labels = data.map((p) => p.t);
    state.charts.traffic.setData(labels, [
      { name: 'Download', color: '#22d3ee', data: data.map((p) => p.down), fill: true },
      { name: 'Upload', color: '#a78bfa', data: data.map((p) => p.up), fill: false },
    ]);
    $('#trafficEmpty').classList.toggle('hidden', data.length > 0);
    if (data.length > 1) {
      const seconds = Math.round((data[data.length - 1].t - data[0].t) / 1000);
      $('#trafficWindow').textContent = `${seconds} detik terakhir · ${data.length} sampel`;
    }
  }

  function renderLatency() {
    const { snap } = state;
    const withData = snap.devices.filter((d) => d.history.some((h) => h.latency != null)).slice(0, 5);
    const labels = withData.length ? withData[0].history.map((h) => h.t) : [];
    const series = withData.map((d, i) => ({
      name: d.name,
      color: COLORS[i % COLORS.length],
      data: d.history.map((h) => h.latency),
      fill: false,
    }));
    state.charts.latency.setData(labels, series);
    $('#latencyEmpty').classList.toggle('hidden', withData.length > 0);
    $('#latencyLegend').innerHTML = withData
      .map((d, i) => `<span><i class="dot" style="background:${COLORS[i % COLORS.length]}"></i>${esc(d.name)}</span>`)
      .join('');
  }

  /* ------------------------------------------------------------------ */
  /* WiFi card                                                           */
  /* ------------------------------------------------------------------ */

  function renderWifiCard() {
    const { snap } = state;
    const current = snap.wifi.current;
    const connected = Boolean(current && current.ssid);
    const signal = connected ? Math.round(current.signal || 0) : 0;
    const ring = $('#signalRing');
    ring.style.setProperty('--value', signal);
    ring.className = `signal-ring ${signal && signal < 40 ? 'bad' : signal && signal < 65 ? 'warn' : ''}`;
    $('#wifiSignal').textContent = connected ? signal : '—';
    $('#wifiSsid').textContent = connected ? current.ssid : 'Belum terhubung';
    $('#wifiDot').className = `status-dot ${connected ? '' : 'off'}`;
    $('#wifiMeta').textContent = connected
      ? `${current.band || '—'} · ch ${current.channel || '—'} · ${current.bssid || '—'}`
      : 'Tidak ada adaptor Wi-Fi yang terhubung';
    const security = connected ? current.security || securityLabel(current.auth, current.cipher) : '—';
    const secBadge = $('#wifiSecurity');
    secBadge.textContent = security;
    secBadge.className = `badge ${security === 'Terbuka' ? 'bad' : security === '—' ? '' : 'ok'}`;

    $('#wifiStations').textContent = snap.clients.stations != null ? snap.clients.stations : '—';
    $('#wifiClients').textContent = snap.clients.count != null ? snap.clients.count : '—';
    $('#wifiChannel').textContent = connected ? `${current.band || '—'} / ${current.channel || '—'}` : '—';
    $('#wifiSourceLabel').textContent = snap.mode === 'demo' ? 'Data demo · jaringan simulasi' : `Windows WLAN · ${snap.wifi.scannedAt ? fmtTime(snap.wifi.scannedAt) : '—'}`;

    const nearby = (snap.wifi.nearby || []).slice(0, 3);
    $('#nearbyMini').innerHTML = nearby.length
      ? nearby.map((n) => `<div class="nearby-mini-row">${signalBars(n.signal)}<span>${esc(n.ssid)}</span><b>${n.signal != null ? `${n.signal}%` : '—'}</b></div>`).join('')
      : '<div class="nearby-mini-row"><span>Belum ada jaringan terdeteksi.</span></div>';
  }

  /* ------------------------------------------------------------------ */
  /* Events                                                              */
  /* ------------------------------------------------------------------ */

  function renderEvents() {
    const events = state.snap.events.slice(0, 8);
    const list = $('#eventList');
    if (!events.length) {
      list.innerHTML = '<div class="empty-state small">Belum ada event.</div>';
      return;
    }
    const icons = { critical: 'i-alert', warning: 'i-alert', success: 'i-check', info: 'i-activity' };
    list.innerHTML = events
      .map(
        (e) => `<div class="event-item">
          <div class="event-icon ${esc(e.level)}"><svg><use href="#${icons[e.level] || 'i-activity'}"/></svg></div>
          <div class="event-body">
            <div class="event-title-row"><strong>${esc(e.title)}</strong><time>${fmtTime(e.t)}</time></div>
            <p>${esc(e.deviceName ? `${e.deviceName} — ${e.message}` : e.message)}</p>
          </div>
        </div>`
      )
      .join('');
  }

  /* ------------------------------------------------------------------ */
  /* Devices                                                             */
  /* ------------------------------------------------------------------ */

  function visibleDevices() {
    const { snap } = state;
    const query = state.search.trim().toLowerCase();
    const rank = { down: 0, warning: 1, unknown: 2, up: 3 };
    return snap.devices
      .filter((d) => {
        if (state.filter !== 'all' && d.status !== state.filter) return false;
        if (!query) return true;
        return [d.name, d.host, d.resolvedHost, d.location, d.type].some((v) => String(v || '').toLowerCase().includes(query));
      })
      .slice()
      .sort((a, b) => (rank[a.status] ?? 9) - (rank[b.status] ?? 9));
  }

  function renderDevices() {
    const { snap } = state;
    const devices = visibleDevices();
    const tbody = $('#deviceRows');
    $('#deviceSummary').textContent = `${snap.kpi.total} perangkat · ${snap.kpi.online} online · ${snap.kpi.offline} offline`;
    $('#deviceEmpty').classList.toggle('hidden', devices.length > 0);

    tbody.innerHTML = devices
      .map((d) => {
        const latencyClass = d.latency == null ? '' : d.latency > snap.config.thresholds.latencyMs ? 'warn' : '';
        const latencyWidth = d.latency == null ? 0 : Math.max(4, Math.min(100, (d.latency / Math.max(150, snap.config.thresholds.latencyMs * 1.4)) * 100));
        const avail = d.availability == null ? 0 : d.availability;
        const traffic = d.downMbps == null && d.upMbps == null
          ? '<span class="muted">—</span>'
          : `<span class="d">↓ ${fmtMbps(d.downMbps)}</span><br><span class="u">↑ ${fmtMbps(d.upMbps)}</span>`;
        return `<tr data-id="${esc(d.id)}">
          <td><div class="device-cell">
            <div class="device-icon ${esc(d.status)}"><svg><use href="#${typeIcon(d.type)}"/></svg></div>
            <div class="device-name"><strong>${esc(d.name)}</strong><span>${esc(d.location)} · ${esc(d.resolvedHost || d.host)}</span></div>
          </div></td>
          <td><span class="status-pill ${esc(d.status)}">${statusText(d.status)}</span></td>
          <td><div class="latency-cell"><b class="${latencyClass}">${d.latency == null ? '—' : `${fmtNum(d.latency, 1)} ms`}</b><span class="latency-bar"><i class="${latencyClass}" style="width:${latencyWidth}%"></i></span></div></td>
          <td class="mono">${d.loss == null ? '—' : `${fmtNum(d.loss, 1)}%`}</td>
          <td><div class="traffic-cell">${traffic}</div></td>
          <td><div class="availability-cell"><b>${fmtNum(avail, 2)}%</b><div class="mini-bar"><span style="width:${Math.max(0, Math.min(100, avail))}%"></span></div></div></td>
          <td class="trend-cell"><canvas data-trend="${esc(d.id)}"></canvas></td>
          <td class="right time-cell">${d.lastCheck ? fmtTime(d.lastCheck) : '—'}</td>
        </tr>`;
      })
      .join('');

    $$('#deviceRows canvas[data-trend]').forEach((canvas) => {
      const id = canvas.dataset.trend;
      const device = devices.find((d) => d.id === id);
      if (!device) return;
      const color = device.status === 'down' ? '#fb7185' : device.status === 'warning' ? '#fbbf24' : '#22d3ee';
      NWCharts.sparkline(canvas, device.history.map((h) => h.latency), color);
    });
  }

  /* ------------------------------------------------------------------ */
  /* WiFi page                                                           */
  /* ------------------------------------------------------------------ */

  function renderWifiPage() {
    const { snap } = state;
    const current = snap.wifi.current;
    const connected = Boolean(current && current.ssid);
    const signal = connected ? Math.round(current.signal || 0) : 0;
    const ring = $('#connRing');
    ring.style.setProperty('--value', signal);
    ring.className = `signal-ring lg ${signal && signal < 40 ? 'bad' : signal && signal < 65 ? 'warn' : ''}`;
    $('#connSignal').textContent = connected ? signal : '—';
    $('#connSsid').textContent = connected ? current.ssid : 'Tidak terhubung';
    $('#connBssid').textContent = connected ? current.bssid || '—' : '—';
    $('#connSub').textContent = connected ? 'Detail adaptor Wi-Fi aktif' : 'Tidak ada koneksi Wi-Fi aktif';
    const security = connected ? current.security || securityLabel(current.auth, current.cipher) : '—';
    const secBadge = $('#connSecurity');
    secBadge.textContent = security;
    secBadge.className = `badge ${security === 'Terbuka' ? 'bad' : security === '—' ? '' : 'ok'}`;
    const connBadge = $('#connBadge');
    connBadge.textContent = connected ? 'Terhubung' : 'Offline';
    connBadge.className = `badge ${connected ? 'ok' : 'bad'}`;
    $('#connBand').textContent = connected ? `${current.band || '—'} · ${current.radio || '—'}` : '—';
    $('#connChannel').textContent = connected ? current.channel || '—' : '—';
    $('#connRadio').textContent = connected ? current.radio || '—' : '—';
    $('#connRate').textContent = connected ? `${current.rxMbps || '—'} / ${current.txMbps || '—'} Mbps` : '—';
    $('#connRssi').textContent = connected && current.rssi != null ? `${current.rssi} dBm` : '—';
    $('#connStations').textContent = snap.clients.stations != null ? `${snap.clients.stations} perangkat` : 'Tidak terpublikasi';
    $('#connUtil').textContent = current && current.utilization != null ? `${current.utilization}%` : 'Tidak terpublikasi';

    const hint = $('#securityHint');
    if (!connected) {
      hint.className = 'security-hint warn';
      hint.textContent = 'Hubungkan adaptor Wi-Fi untuk melihat detail jaringan.';
    } else if (security === 'Terbuka') {
      hint.className = 'security-hint bad';
      hint.textContent = 'Jaringan terbuka: trafik Wi-Fi tidak dienkripsi. Hindari login ke akun penting sebelum memakai VPN.';
    } else if (security === 'WPA3') {
      hint.className = 'security-hint ok';
      hint.textContent = 'WPA3 aktif — enkripsi modern. Tetap gunakan HTTPS untuk lapisan aplikasi.';
    } else {
      hint.className = 'security-hint warn';
      hint.textContent = `${security} terdeteksi. Enkripsi Wi-Fi aktif, tetapi keamanan tetap bergantung pada kata sandi dan konfigurasi router.`;
    }

    $('#nearbySub').textContent = `${snap.wifi.nearby.length} jaringan · ${snap.wifi.scannedAt ? `scan ${fmtTime(snap.wifi.scannedAt)}` : 'belum scan'}`;
    const scanState = $('#wifiScanState');
    scanState.textContent = snap.wifi.scanning ? 'memindai…' : snap.mode === 'demo' ? 'demo' : snap.wifi.source === 'windows' ? 'windows wlan' : '';
    scanState.className = `scan-state ${snap.wifi.scanning ? 'busy' : ''}`;
    setBusy($('#scanWifiBtn'), Boolean(snap.wifi.scanning), 'Memindai Wi-Fi…');

    const nearby = snap.wifi.nearby || [];
    $('#nearbyRows').innerHTML = nearby
      .map((n) => {
        const sec = n.security || securityLabel(n.auth, n.cipher);
        const util = n.utilization == null ? '—' : `${n.utilization}%`;
        return `<tr>
          <td><div class="device-cell"><div class="device-icon ${sec === 'Terbuka' ? 'warning' : 'up'}"><svg><use href="#i-wifi"/></svg></div>
            <div class="device-name"><strong>${esc(n.ssid)}</strong><span>${esc(n.radio || '—')}</span></div></div></td>
          <td><div class="latency-cell">${signalBars(n.signal)}<b>${n.signal != null ? `${n.signal}%` : '—'}</b></div></td>
          <td class="mono">${esc(n.band || '—')} / ${n.channel || '—'}</td>
          <td><span class="badge ${sec === 'Terbuka' ? 'bad' : sec === 'WPA3' ? 'ok' : ''}">${esc(sec)}</span></td>
          <td class="mono">${n.stations == null ? '—' : n.stations}</td>
          <td class="mono">${util}</td>
          <td class="mono time-cell">${esc(n.bssid || '—')}</td>
        </tr>`;
      })
      .join('');
    $('#nearbyEmpty').classList.toggle('hidden', nearby.length > 0);

    renderChannelChart(nearby, connected ? current.channel : null);

    const clients = snap.clients.list || [];
    const online = clients.filter((c) => c.status === 'online').length;
    $('#clientsSub').textContent = `${clients.length} perangkat terlihat · subnet ${snap.clients.subnet || '—'}`;
    $('#clientScanState').textContent = snap.clients.scanning ? 'memindai…' : snap.clients.scannedAt ? `scan ${fmtTime(snap.clients.scannedAt)}` : 'belum scan';
    $('#clientScanState').className = `scan-state ${snap.clients.scanning ? 'busy' : ''}`;
    setBusy($('#scanClientsBtn'), Boolean(snap.clients.scanning), 'Memindai klien…');
    $('#clientSummary').innerHTML = `
      <span class="summary-chip"><span class="dot emerald"></span>Online <b>${online}</b></span>
      <span class="summary-chip"><span class="dot amber"></span>Idle <b>${clients.length - online}</b></span>
      <span class="summary-chip">Gateway <b>${esc(snap.clients.gateway || '—')}</b></span>
      <span class="summary-chip">IP lokal <b>${esc(snap.clients.localIp || '—')}</b></span>`;

    $('#clientRows').innerHTML = clients
      .map((c) => `<tr>
        <td><div class="client-cell"><div class="client-avatar">${esc(initials(c.name))}</div><div><strong>${esc(c.name)}</strong><span>${c.role === 'gateway' ? 'Gateway jaringan' : c.role === 'self' ? 'Komputer ini' : 'Klien'}</span></div></div></td>
        <td class="mono">${esc(c.ip)}</td>
        <td class="mono time-cell">${esc(c.mac)}</td>
        <td>${esc(c.vendor || '—')}</td>
        <td><span class="status-pill ${c.status === 'online' ? 'up' : 'unknown'}">${c.status === 'online' ? 'Online' : 'Idle'}</span></td>
        <td class="right time-cell">${fmtAgo(c.lastSeen || snap.clients.scannedAt)}</td>
      </tr>`)
      .join('');
    $('#clientEmpty').classList.toggle('hidden', clients.length > 0);
  }

  function renderChannelChart(nearby, activeChannel) {
    const counts = new Array(14).fill(0);
    nearby.forEach((n) => {
      if (n.channel >= 1 && n.channel <= 14) counts[n.channel - 1] += 1;
    });
    const max = Math.max(1, ...counts);
    $('#channelChart').innerHTML = counts
      .map((count, i) => {
        const height = count === 0 ? 2 : Math.max(6, (count / max) * 100);
        return `<div class="channel-col ${activeChannel === i + 1 ? 'active' : ''}" title="Channel ${i + 1}: ${count} jaringan">
          <div class="bar" style="height:${height}%"></div><span>${i + 1}</span>
        </div>`;
      })
      .join('');

    const active = Number(activeChannel);
    const busiest = counts.indexOf(Math.max(...counts));
    let insight;
    if (active > 14) {
      insight = `Koneksi aktif di <b>5 GHz (channel ${active})</b> — di luar grafik 2.4 GHz.`;
    } else if (active >= 1 && active <= 14) {
      insight = `Koneksi aktif di <b>channel ${active}</b> (${counts[active - 1]} jaringan terdeteksi).`;
    } else {
      insight = 'Belum ada koneksi Wi-Fi aktif.';
    }
    if (counts[busiest] > 1) {
      insight += ` Channel <b>${busiest + 1}</b> paling padat dengan ${counts[busiest]} jaringan — pertimbangkan pindah ke 5 GHz bila tersedia.`;
    }
    $('#channelInsight').innerHTML = insight;
  }

  /* ------------------------------------------------------------------ */
  /* Activity                                                            */
  /* ------------------------------------------------------------------ */

  function clientNameFor(ip) {
    const { snap } = state;
    if (!snap) return ip;
    const found = (snap.clients.list || []).find((c) => c.ip === ip);
    if (found) return found.name;
    const entry = (snap.activity.entries || []).find((e) => e.clientIp === ip && e.clientName);
    return entry ? entry.clientName : ip;
  }

  function renderActivity() {
    const { snap } = state;
    const act = snap.activity;
    const demo = act.source === 'demo';
    const running = snap.config.dns.enabled;
    const dnsStatus = $('#dnsStatus');
    if (demo) {
      dnsStatus.className = 'status-pill up';
      dnsStatus.textContent = 'Feed demo aktif';
      $('#dnsEndpoint').textContent = running
        ? `Logger asli aktif · UDP :${snap.config.dns.port}`
        : 'Logger DNS asli: nonaktif';
    } else {
      dnsStatus.className = `status-pill ${running ? 'up' : 'unknown'}`;
      dnsStatus.textContent = running ? 'DNS logger aktif' : 'DNS logger nonaktif';
      $('#dnsEndpoint').textContent = `UDP ${location.hostname}:${snap.config.dns.port}`;
    }
    $('#dnsPort').textContent = snap.config.dns.port;
    $('#dnsPortInline').textContent = snap.config.dns.port;
    $('#dnsUpstream').textContent = snap.config.dns.upstream;
    $('#dnsIpInline').textContent = snap.clients.localIp || 'IP-LAN';
    const toggle = $('#dnsToggleBtn');
    toggle.textContent = running ? 'Hentikan DNS Logger' : 'Aktifkan DNS Logger';
    toggle.className = `btn ${running ? 'btn-ghost' : 'btn-primary'}`;
    toggle.disabled = false;

    const stats = act.stats || { total: 0, uniqueDomains: 0, uniqueClients: 0, topDomains: [], topClients: [] };
    $('#actTotal').textContent = nf.format(stats.total || 0);
    $('#actDomains').textContent = nf.format(stats.uniqueDomains || 0);
    $('#actClients').textContent = nf.format(stats.uniqueClients || 0);
    $('#feedSub').textContent = demo
      ? 'Simulasi aktivitas — aktifkan mode Live + DNS logger untuk data nyata'
      : running
      ? 'Domain yang baru diminta perangkat'
      : 'Logger nonaktif — aktifkan untuk mulai mencatat';

    const topDomains = stats.topDomains || [];
    $('#topDomains').innerHTML = topDomains.length
      ? topDomains
          .map((d, i) => {
            const width = Math.max(3, (d.count / Math.max(1, topDomains[0].count)) * 100);
            return `<div class="rank-item"><span class="rank-num">${String(i + 1).padStart(2, '0')}</span>
              <div class="rank-main"><div class="rank-top"><span class="rank-domain">${esc(d.domain)}</span><span class="rank-count">${nf.format(d.count)}×</span></div>
              <div class="rank-bar"><i style="width:${width}%"></i></div></div>
              <span class="cat ${esc(d.category)}">${esc(d.category)}</span></div>`;
          })
          .join('')
      : '<div class="empty-state small">Belum ada data domain.</div>';

    const topClients = stats.topClients || [];
    $('#topClients').innerHTML = topClients.length
      ? topClients
          .map((c, i) => {
            const width = Math.max(3, (c.count / Math.max(1, topClients[0].count)) * 100);
            return `<div class="rank-item"><span class="rank-num">${String(i + 1).padStart(2, '0')}</span>
              <div class="rank-main"><div class="rank-top"><span class="rank-domain">${esc(clientNameFor(c.ip))}</span><span class="rank-count">${nf.format(c.count)}×</span></div>
              <div class="rank-bar"><i style="width:${width}%"></i></div></div>
              <span class="mono rank-count">${esc(c.ip)}</span></div>`;
          })
          .join('')
      : '<div class="empty-state small">Belum ada klien.</div>';

    const entries = act.entries || [];
    $('#feedBadge').textContent = `${entries.length} entri`;
    $('#activityRows').innerHTML = entries
      .slice(0, 60)
      .map(
        (e) => `<tr>
          <td class="mono time-cell">${fmtTime(e.t)}</td>
          <td><strong>${esc(e.clientName || clientNameFor(e.clientIp))}</strong><br><span class="time-cell">${esc(e.clientIp)}</span></td>
          <td class="mono">${esc(e.domain)}</td>
          <td><span class="cat ${esc(e.category)}">${esc(e.category)}</span></td>
          <td class="mono">${esc(e.qtype || 'A')}</td>
        </tr>`
      )
      .join('');
    $('#activityEmpty').classList.toggle('hidden', entries.length > 0);
  }

  /* ------------------------------------------------------------------ */
  /* Alerts page                                                         */
  /* ------------------------------------------------------------------ */

  function renderAlerts() {
    const { snap } = state;
    const cfg = snap.config;
    const tg = cfg.telegram;
    const wa = cfg.whatsapp;
    const tgBadge = $('#tgStatus');
    tgBadge.textContent = tg.enabled ? (tg.configured ? 'Aktif' : 'Belum lengkap') : 'Nonaktif';
    tgBadge.className = `badge ${tg.enabled ? (tg.configured ? 'ok' : 'warn') : ''}`;
    const waBadge = $('#waStatus');
    waBadge.textContent = wa.enabled ? (wa.configured ? 'Aktif' : 'Belum lengkap') : 'Nonaktif';
    waBadge.className = `badge ${wa.enabled ? (wa.configured ? 'ok' : 'warn') : ''}`;

    const active = [tg.enabled && tg.configured, wa.enabled && wa.configured].filter(Boolean).length;
    const summary = $('#notifSummary');
    summary.className = `status-pill ${active ? 'up' : 'unknown'}`;
    summary.textContent = active ? `${active} channel aktif` : 'Belum ada channel aktif';

    const logs = snap.alerts || [];
    $('#alertLogCount').textContent = logs.length;
    $('#alertLogRows').innerHTML = logs
      .map(
        (l) => `<tr>
          <td class="mono time-cell">${fmtTime(l.t)}</td>
          <td>${esc(l.channel)}</td>
          <td>${esc(l.title)}${l.error ? `<br><span class="time-cell">${esc(l.error)}</span>` : ''}</td>
          <td><span class="status-pill ${l.ok ? 'up' : 'down'}">${l.ok ? 'Terkirim' : 'Gagal'}</span></td>
        </tr>`
      )
      .join('');
    $('#alertLogEmpty').classList.toggle('hidden', logs.length > 0);
  }

  function populateConfig(cfg) {
    $('#tgEnabled').checked = Boolean(cfg.telegram.enabled);
    $('#tgToken').value = '';
    $('#tgToken').placeholder = cfg.telegram.tokenSet ? '•••••• tersimpan — isi untuk mengganti' : '123456:ABC-DEF…';
    $('#tgChat').value = '';
    $('#tgChat').placeholder = cfg.telegram.chatId || '123456789';

    $('#waEnabled').checked = Boolean(cfg.whatsapp.enabled);
    $('#waProvider').value = cfg.whatsapp.provider || 'generic';
    $('#waUrl').value = cfg.whatsapp.url || '';
    $('#waToken').value = '';
    $('#waToken').placeholder = cfg.whatsapp.tokenSet ? '•••••• tersimpan — isi untuk mengganti' : 'token / API key';
    $('#waTarget').value = '';
    $('#waTarget').placeholder = cfg.whatsapp.target || '62812…';
    updateWaFields();

    $('#ruleLatency').value = cfg.thresholds.latencyMs;
    $('#ruleLoss').value = cfg.thresholds.lossPct;
    $('#ruleCooldown').value = cfg.thresholds.cooldownSec;
    $('#ruleRecovery').checked = cfg.thresholds.notifyRecovery;
  }

  function updateWaFields() {
    const provider = $('#waProvider').value;
    $('#waPhoneField').classList.toggle('hidden', provider !== 'meta');
    const url = $('#waUrl');
    if (provider === 'fonnte') url.placeholder = 'https://api.fonnte.com/send (default)';
    else if (provider === 'wablas') url.placeholder = 'https://pati.wablas.com/api/send-message (default)';
    else if (provider === 'meta') url.placeholder = 'Tidak perlu — memakai Graph API';
    else url.placeholder = 'https://webhook.example.com/notify';
  }

  /* ------------------------------------------------------------------ */
  /* Device drawer                                                       */
  /* ------------------------------------------------------------------ */

  function openDrawer(id) {
    state.selectedDevice = id;
    const { snap } = state;
    const device = snap.devices.find((d) => d.id === id);
    if (!device) return;
    $('#drawerName').textContent = device.name;
    $('#drawerLocation').textContent = `${device.location} · ${device.host}`;
    $('#drawerHost').textContent = device.resolvedHost || device.host;
    const pill = $('#drawerStatus');
    pill.className = `status-pill ${device.status}`;
    pill.textContent = statusText(device.status);
    $('#drawerType').textContent = device.type;
    $('#drawerResolved').textContent = device.resolvedHost || device.host;
    $('#drawerCheck').textContent = device.lastCheck ? fmtTime(device.lastCheck) : '—';
    $('#drawerNote').textContent = snap.mode === 'demo' ? 'Simulasi (demo)' : 'Ping ICMP live';
    $('#drawerBackdrop').classList.add('open');
    $('#deviceDrawer').classList.add('open');
    $('#deviceDrawer').setAttribute('aria-hidden', 'false');
    renderDrawer(id);
  }

  function closeDrawer() {
    state.selectedDevice = null;
    $('#drawerBackdrop').classList.remove('open');
    $('#deviceDrawer').classList.remove('open');
    $('#deviceDrawer').setAttribute('aria-hidden', 'true');
  }

  function renderDrawer(id) {
    const { snap } = state;
    const device = snap.devices.find((d) => d.id === id);
    if (!device) return;
    $('#drawerLatency').textContent = fmtMs(device.latency);
    $('#drawerLoss').textContent = device.loss == null ? '—' : `${fmtNum(device.loss, 1)}%`;
    $('#drawerAvailability').textContent = `${fmtNum(device.availability, 2)}%`;
    $('#drawerTraffic').textContent = device.downMbps == null && device.upMbps == null
      ? '—'
      : `↓ ${fmtMbps(device.downMbps)} / ↑ ${fmtMbps(device.upMbps)}`;
    $('#drawerUpdated').textContent = device.lastCheck ? `update ${fmtTime(device.lastCheck)}` : '—';
    const pill = $('#drawerStatus');
    pill.className = `status-pill ${device.status}`;
    pill.textContent = statusText(device.status);

    if (!state.charts.drawer) {
      state.charts.drawer = new NWCharts.LineChart($('#drawerChart'), {
        yFormat: (v) => `${Math.round(v)}`,
        tooltipFormat: (s, v) => fmtMs(v),
        fill: true,
      });
    }
    state.charts.drawer.setData(
      device.history.map((h) => h.t),
      [{ name: device.name, color: device.status === 'down' ? '#fb7185' : '#22d3ee', data: device.history.map((h) => h.latency), fill: true }]
    );
  }

  /* ------------------------------------------------------------------ */
  /* Navigation                                                          */
  /* ------------------------------------------------------------------ */

  function setPage(page) {
    if (!PAGE_META[page]) return;
    state.page = page;
    $$('.page').forEach((el) => el.classList.toggle('active', el.id === `page-${page}`));
    $$('.nav-item').forEach((btn) => btn.classList.toggle('active', btn.dataset.page === page));
    const [title, sub] = PAGE_META[page];
    $('#pageTitle').textContent = title;
    $('#pageSub').textContent = sub;
    $('#sidebar').classList.remove('open');
    $('#sidebarBackdrop').classList.remove('open');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (page === 'alerts' && state.snap && !state.configLoaded) {
      populateConfig(state.snap.config);
      state.configLoaded = true;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Events / forms                                                      */
  /* ------------------------------------------------------------------ */

  function bind() {
    $$('.nav-item').forEach((btn) => btn.addEventListener('click', () => setPage(btn.dataset.page)));
    $$('[data-goto]').forEach((btn) => btn.addEventListener('click', () => setPage(btn.dataset.goto)));

    $('#menuBtn').addEventListener('click', () => {
      $('#sidebar').classList.toggle('open');
      $('#sidebarBackdrop').classList.toggle('open');
    });
    $('#sidebarBackdrop').addEventListener('click', () => {
      $('#sidebar').classList.remove('open');
      $('#sidebarBackdrop').classList.remove('open');
    });

    $$('.mode-switch button').forEach((btn) =>
      btn.addEventListener('click', async () => {
        const mode = btn.dataset.mode;
        if (!state.snap || state.snap.mode === mode || state.busy) return;
        state.busy = true;
        setBusy(btn, true, '…');
        try {
          await api('/api/mode', { mode });
          await refreshState();
          toast('info', 'Mode diubah', mode === 'demo' ? 'Dashboard memakai data simulasi.' : 'Dashboard memakai ping & trafik nyata.');
        } catch (err) {
          toast('critical', 'Gagal mengubah mode', err.message);
        } finally {
          state.busy = false;
          setBusy(btn, false);
        }
      })
    );

    $('#incidentBtn').addEventListener('click', async () => {
      const btn = $('#incidentBtn');
      setBusy(btn, true, 'Membuat gangguan…');
      try {
        const res = await api('/api/incident', {});
        toast('warning', 'Simulasi gangguan', `${res.device} dibuat offline selama 14 detik.`);
        await refreshState();
      } catch (err) {
        toast('critical', 'Gagal simulasi', err.message);
      } finally {
        setBusy(btn, false);
      }
    });

    $('#bannerAction').addEventListener('click', () => {
      const offline = state.snap && state.snap.devices.find((d) => d.status === 'down');
      if (offline) openDrawer(offline.id);
    });

    $('#deviceSearch').addEventListener('input', (e) => {
      state.search = e.target.value;
      renderDevices();
    });
    $$('#deviceFilters .chip').forEach((chip) =>
      chip.addEventListener('click', () => {
        state.filter = chip.dataset.filter;
        $$('#deviceFilters .chip').forEach((c) => c.classList.toggle('active', c === chip));
        renderDevices();
      })
    );
    $('#deviceRows').addEventListener('click', (e) => {
      const row = e.target.closest('tr[data-id]');
      if (row) openDrawer(row.dataset.id);
    });

    $('#drawerClose').addEventListener('click', closeDrawer);
    $('#drawerBackdrop').addEventListener('click', closeDrawer);

    $('#scanWifiBtn').addEventListener('click', async () => {
      setBusy($('#scanWifiBtn'), true, 'Memindai Wi-Fi…');
      try {
        const res = await api('/api/scan/wifi', {});
        toast('success', 'Scan Wi-Fi selesai', `${res.networks} jaringan terdeteksi.`);
        await refreshState();
      } catch (err) {
        toast('critical', 'Scan Wi-Fi gagal', err.message);
      } finally {
        setBusy($('#scanWifiBtn'), false);
      }
    });

    $('#scanClientsBtn').addEventListener('click', async () => {
      setBusy($('#scanClientsBtn'), true, 'Memindai 254 host…');
      try {
        const res = await api('/api/scan/clients', {});
        toast('success', 'Scan klien selesai', `${res.count} perangkat terlihat di jaringan.`);
        await refreshState();
      } catch (err) {
        toast('critical', 'Scan klien gagal', err.message);
      } finally {
        setBusy($('#scanClientsBtn'), false);
      }
    });

    $('#dnsToggleBtn').addEventListener('click', async () => {
      const enabled = !(state.snap && state.snap.config.dns.enabled);
      if (enabled) {
        const ok = window.confirm(
          'Aktifkan DNS logger?\n\nLogger mencatat nama domain yang diminta perangkat di jaringan ini. Gunakan hanya di jaringan milik Anda / yang Anda punya izin, dan beri tahu penggunanya. Data disimpan di memori dan hilang saat server berhenti.'
        );
        if (!ok) return;
      }
      setBusy($('#dnsToggleBtn'), true, enabled ? 'Mengaktifkan…' : 'Menghentikan…');
      try {
        await api('/api/dns', { enabled });
        toast('success', enabled ? 'DNS logger aktif' : 'DNS logger berhenti', enabled ? 'Arahkan DNS perangkat ke IP komputer ini untuk mulai mencatat.' : 'Pencatatan domain dihentikan.');
        await refreshState();
      } catch (err) {
        toast('critical', 'Gagal mengubah DNS logger', err.message);
      } finally {
        setBusy($('#dnsToggleBtn'), false);
      }
    });

    $('#tgForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = { telegram: { enabled: $('#tgEnabled').checked } };
      const token = $('#tgToken').value.trim();
      const chat = $('#tgChat').value.trim();
      if (token) body.telegram.botToken = token;
      if (chat) body.telegram.chatId = chat;
      const hint = $('#tgHint');
      try {
        const res = await api('/api/config', body);
        hint.className = 'form-hint ok';
        hint.textContent = 'Tersimpan.';
        $('#tgToken').value = '';
        $('#tgToken').placeholder = res.config.telegram.tokenSet ? '•••••• tersimpan — isi untuk mengganti' : '123456:ABC-DEF…';
        $('#tgChat').value = '';
        $('#tgChat').placeholder = res.config.telegram.chatId || '123456789';
        toast('success', 'Konfigurasi Telegram disimpan', body.telegram.enabled ? 'Alert akan dikirim ke chat yang terdaftar.' : 'Notifikasi Telegram dimatikan.');
        await refreshState();
      } catch (err) {
        hint.className = 'form-hint bad';
        hint.textContent = err.message;
      }
    });

    $('#waProvider').addEventListener('change', updateWaFields);

    $('#waForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = {
        whatsapp: {
          enabled: $('#waEnabled').checked,
          provider: $('#waProvider').value,
          url: $('#waUrl').value.trim(),
          phoneNumberId: $('#waPhoneId').value.trim(),
        },
      };
      const token = $('#waToken').value.trim();
      const target = $('#waTarget').value.trim();
      if (token) body.whatsapp.token = token;
      if (target) body.whatsapp.target = target;
      const hint = $('#waHint');
      try {
        const res = await api('/api/config', body);
        hint.className = 'form-hint ok';
        hint.textContent = 'Tersimpan.';
        $('#waToken').value = '';
        $('#waToken').placeholder = res.config.whatsapp.tokenSet ? '•••••• tersimpan — isi untuk mengganti' : 'token / API key';
        $('#waTarget').value = '';
        $('#waTarget').placeholder = res.config.whatsapp.target || '62812…';
        toast('success', 'Konfigurasi WhatsApp disimpan', body.whatsapp.enabled ? 'Alert akan dikirim via provider terpilih.' : 'Notifikasi WhatsApp dimatikan.');
        await refreshState();
      } catch (err) {
        hint.className = 'form-hint bad';
        hint.textContent = err.message;
      }
    });

    $('#tgTest').addEventListener('click', () => testChannel('telegram', $('#tgTest'), $('#tgHint')));
    $('#waTest').addEventListener('click', () => testChannel('whatsapp', $('#waTest'), $('#waHint')));

    $('#ruleForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const hint = $('#ruleHint');
      try {
        await api('/api/config', {
          thresholds: {
            latencyMs: Number($('#ruleLatency').value),
            lossPct: Number($('#ruleLoss').value),
            cooldownSec: Number($('#ruleCooldown').value),
            notifyRecovery: $('#ruleRecovery').checked,
          },
        });
        hint.className = 'form-hint ok';
        hint.textContent = 'Aturan diperbarui.';
        toast('success', 'Aturan alert disimpan', 'Ambang batas baru langsung dipakai.');
        await refreshState();
      } catch (err) {
        hint.className = 'form-hint bad';
        hint.textContent = err.message;
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closeDrawer();
        $('#sidebar').classList.remove('open');
        $('#sidebarBackdrop').classList.remove('open');
      }
    });

    window.addEventListener('resize', () => {
      Object.values(state.charts).forEach((chart) => chart && chart.resize());
    });
  }

  async function testChannel(channel, btn, hint) {
    setBusy(btn, true, 'Mengirim…');
    hint.className = 'form-hint';
    hint.textContent = '';
    try {
      await api('/api/notify/test', { channel });
      hint.className = 'form-hint ok';
      hint.textContent = 'Terkirim. Cek aplikasi Anda.';
      toast('success', 'Tes terkirim', `Pesan uji ${channel} berhasil dikirim.`);
    } catch (err) {
      hint.className = 'form-hint bad';
      hint.textContent = err.message;
      toast('critical', `Tes ${channel} gagal`, err.message);
    } finally {
      setBusy(btn, false);
    }
  }

  /* ------------------------------------------------------------------ */
  /* Clock & boot                                                        */
  /* ------------------------------------------------------------------ */

  function tickClock() {
    const now = new Date(Date.now() + state.offset);
    $('#clock').textContent = [now.getHours(), now.getMinutes(), now.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':');
  }

  function startPolling() {
    if (state.pollTimer) return;
    const poll = async () => {
      try {
        const res = await fetch('/api/state', { cache: 'no-store' });
        if (res.ok) applySnapshot(await res.json());
      } catch (_) {}
    };
    state.pollTimer = setInterval(poll, 3000);
    poll();
  }

  function stopPolling() {
    if (state.pollTimer) clearInterval(state.pollTimer);
    state.pollTimer = null;
  }

  function connectSSE() {
    if (typeof EventSource === 'undefined') {
      startPolling();
      return;
    }
    if (state.sse) state.sse.close();
    const es = new EventSource('/api/stream');
    es.addEventListener('snapshot', (event) => {
      try {
        applySnapshot(JSON.parse(event.data));
      } catch (_) {}
    });
    es.onopen = () => {
      stopPolling();
      const dot = $('.live-dot');
      if (dot) dot.style.background = 'var(--emerald)';
    };
    es.onerror = () => {
      const dot = $('.live-dot');
      if (dot) dot.style.background = 'var(--rose)';
      try { es.close(); } catch (_) {}
      if (state.sse === es) state.sse = null;
      startPolling();
      if (!state.sseRetry) {
        state.sseRetry = setTimeout(() => {
          state.sseRetry = null;
          if (!state.sse) connectSSE();
        }, 30000);
      }
    };
    state.sse = es;
  }

  async function boot() {
    bind();
    initCharts();
    tickClock();
    setInterval(tickClock, 1000);
    try {
      const res = await fetch('/api/state', { cache: 'no-store' });
      if (res.ok) applySnapshot(await res.json());
    } catch (err) {
      toast('critical', 'Tidak bisa memuat data', 'Pastikan server NetWatch berjalan.');
    }
    connectSSE();
    setInterval(() => {
      if (!state.snap) return;
      renderActivity();
      renderWifiPage();
    }, 5000);
  }

  boot();
})();

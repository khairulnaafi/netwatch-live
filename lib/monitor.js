'use strict';

const EventEmitter = require('events');
const os = require('os');
const { initDemoDevices, stepDemo, demoTickActivity, DEMO_CURRENT, DEMO_NEARBY, DEMO_CLIENTS, categorize } = require('./demo');
const net = require('./network');
const wifi = require('./wifi');
const { Notifier } = require('./notifier');
const { DnsLogger } = require('./dnslog');
const { uid, round, clamp, pick, rand } = require('./util');

const PALETTE = ['#22d3ee', '#a78bfa', '#34d399', '#fbbf24', '#fb7185', '#60a5fa'];

function mask(value) {
  if (!value) return '';
  const text = String(value);
  if (text.length <= 4) return '****';
  return `${'*'.repeat(Math.min(8, text.length - 4))}${text.slice(-4)}`;
}

function durationText(ms) {
  const sec = Math.max(0, Math.round(ms / 1000));
  if (sec < 60) return `${sec} detik`;
  const min = Math.floor(sec / 60);
  return `${min} menit ${sec % 60} detik`;
}

function demoStats(store) {
  const topDomains = Array.from(store.domains.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([domain, count]) => ({ domain, count, category: categorize(domain) }));
  const topClients = Array.from(store.clients.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([ip, count]) => ({ ip, count }));
  return {
    total: store.total,
    uniqueDomains: store.domains.size,
    uniqueClients: store.clients.size,
    topDomains,
    topClients,
  };
}

class Monitor extends EventEmitter {
  constructor(config) {
    super();
    this.config = config;
    this.mode = config.demoMode ? 'demo' : 'live';
    this.devices = [];
    this.traffic = [];
    this.events = [];
    this.startedAt = Date.now();
    this.alertCooldown = new Map();
    this.timer = null;
    this.tickBusy = false;
    this.notifier = new Notifier(() => this.config);
    this.dns = new DnsLogger(() => this.config);
    this.wifi = { current: null, nearby: [], scannedAt: null, source: this.mode, scanning: false, error: null };
    this.clients = { list: [], scannedAt: null, scanning: false, subnet: null, localIp: null, gateway: null, deep: false };
    this.demoActivity = [];
    this.demoStore = { total: 0, domains: new Map(), clients: new Map() };
    this.wifiScanning = false;
    this.clientScanning = false;
    this.lastWifiScan = 0;
    this.lastClientRefresh = 0;
    this.liveSeen = { rx: null, tx: null };
    this.initMode(this.mode, { silent: true });
  }

  /* ------------------------------------------------------------------ */
  /* Lifecycle                                                           */
  /* ------------------------------------------------------------------ */

  start() {
    this.pushEvent('info', 'Pemantauan dimulai', `Mode ${this.mode === 'demo' ? 'demo' : 'live'} aktif.`);
    if (this.config.dns && this.config.dns.enabled) {
      this.dns.start().catch(() => {});
    }
    this.restartTimer();
    this.tick();
    if (this.mode === 'live') {
      this.scanWifi(true).catch(() => {});
      this.scanClients(true).catch(() => {});
    }
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.dns.stop();
  }

  restartTimer() {
    if (this.timer) clearInterval(this.timer);
    const ms = this.mode === 'demo'
      ? Number(this.config.tickMs) || 2000
      : Number(this.config.liveTickMs) || 3000;
    this.timer = setInterval(() => this.tick(), ms);
  }

  initMode(mode, { silent = false } = {}) {
    this.mode = mode;
    this.startedAt = Date.now();
    this.traffic = [];
    this.events = [];
    this.alertCooldown.clear();
    this.liveSeen = { rx: null, tx: null };

    if (mode === 'demo') {
      this.devices = initDemoDevices();
      this.seedDemoHistory();
      this.wifi = {
        current: { ...DEMO_CURRENT },
        nearby: DEMO_NEARBY.map((n) => ({ ...n })),
        scannedAt: Date.now(),
        source: 'demo',
        scanning: false,
        error: null,
      };
      this.clients = {
        list: DEMO_CLIENTS.map((c) => ({ ...c, lastSeen: Date.now() })),
        scannedAt: Date.now(),
        scanning: false,
        subnet: '192.168.1.0/24',
        localIp: '192.168.1.68',
        gateway: '192.168.1.1',
        deep: true,
        count: DEMO_CLIENTS.length,
      };
      this.demoActivity = [];
      this.demoStore = { total: 0, domains: new Map(), clients: new Map() };
      this.demoWifiAt = Date.now();
      this.demoClientsAt = Date.now();
      this.seedDemoActivity();
      this.seedDemoEvents();
    } else {
      this.devices = (this.config.liveDevices || []).map((d) => ({
        id: d.id || uid('dev'),
        name: d.name || d.host,
        host: d.host || 'auto',
        resolvedHost: null,
        type: d.type || 'device',
        location: d.location || 'Jaringan lokal',
        status: 'unknown',
        latency: null,
        loss: 0,
        downMbps: null,
        upMbps: null,
        availability: 100,
        upSamples: 0,
        totalSamples: 0,
        recent: [],
        downSince: null,
        lastCheck: null,
        prevStatus: null,
        history: [],
      }));
      this.wifi = { current: null, nearby: [], scannedAt: null, source: 'live', scanning: false, error: null };
      this.clients = { list: [], scannedAt: null, scanning: false, subnet: null, localIp: null, gateway: null, deep: false };
      this.demoActivity = [];
    }

    if (!silent) {
      this.pushEvent('info', 'Mode beralih', `Sekarang memantau dalam mode ${mode === 'demo' ? 'demo' : 'live'}.`);
    }
  }

  seedDemoHistory() {
    const now = Date.now();
    const points = 60;
    this.traffic = [];
    for (const device of this.devices) {
      device.history = [];
      device.upSamples = 0;
      device.totalSamples = 0;
      for (let i = 0; i < points; i += 1) {
        const t = now - (points - i) * 2000;
        const spiking = device.id === 'apmeet' && i > 40 && i < 47;
        const latency = Math.max(1, device.baseLatency * (spiking ? 2.1 : 1) + rand(-device.jitter, device.jitter));
        const loss = spiking ? round(rand(0.4, 2.1), 1) : Math.random() < 0.05 ? 0.1 : 0;
        const status = latency > (this.config.thresholds.latencyMs || 120) ? 'warning' : 'up';
        device.history.push({
          t,
          latency: round(latency, 1),
          loss,
          down: round(device.down * rand(0.7, 1.25), 2),
          up: round(device.up * rand(0.7, 1.25), 2),
          status,
        });
        device.upSamples += 1;
        device.totalSamples += 1;
      }
      device.availability = 100;
      device.prevStatus = device.status;
      device.downMbps = device.down * rand(0.8, 1.1);
      device.upMbps = device.up * rand(0.8, 1.1);
      device.lastCheck = now;
    }
    for (let i = 0; i < points; i += 1) {
      const t = now - (points - i) * 2000;
      const down = this.devices.reduce((sum, d) => sum + (d.history[i] ? d.history[i].down : 0), 0);
      const up = this.devices.reduce((sum, d) => sum + (d.history[i] ? d.history[i].up : 0), 0);
      this.traffic.push({ t, down: round(down * 1.04, 2), up: round(up * 1.04, 2) });
    }
  }

  seedDemoActivity() {
    for (let i = 0; i < 16; i += 1) {
      const entry = demoTickActivity(DEMO_CLIENTS, 1)[0];
      entry.t = Date.now() - (16 - i) * 4200;
      this.addDemoActivity(entry, true);
    }
  }

  addDemoActivity(entry, count = true) {
    if (count) {
      this.demoStore.total += 1;
      this.demoStore.domains.set(entry.domain, (this.demoStore.domains.get(entry.domain) || 0) + 1);
      this.demoStore.clients.set(entry.clientIp, (this.demoStore.clients.get(entry.clientIp) || 0) + 1);
    }
    this.demoActivity.unshift(entry);
    if (this.demoActivity.length > 120) this.demoActivity.length = 120;
  }

  seedDemoEvents() {
    const now = Date.now();
    const defs = [
      { level: 'warning', title: 'Latensi tinggi', message: 'Latensi 168 ms melewati ambang 120 ms.', deviceId: 'apmeet', deviceName: 'AP Meeting Room', ago: 95 },
      { level: 'success', title: 'Perangkat pulih', message: 'Perangkat kembali merespons setelah 18 detik.', deviceId: 'swg', deviceName: 'Switch Gudang', ago: 420 },
      { level: 'info', title: 'Scan Wi-Fi selesai', message: '8 jaringan terdeteksi di sekitar kantor.', deviceId: null, deviceName: null, ago: 900 },
      { level: 'critical', title: 'Perangkat offline', message: 'Tidak merespons ping. Lokasi: Area Parkir.', deviceId: 'cam2', deviceName: 'CCTV Parkir', ago: 1500 },
      { level: 'success', title: 'Perangkat pulih', message: 'Perangkat kembali merespons setelah 34 detik.', deviceId: 'cam2', deviceName: 'CCTV Parkir', ago: 1380 },
      { level: 'info', title: 'Aturan alert diperbarui', message: 'Ambang latency 120 ms, cooldown 60 detik.', deviceId: null, deviceName: null, ago: 2400 },
    ];
    this.events = defs.map((d) => ({
      id: uid('evt'),
      t: now - d.ago * 1000,
      level: d.level,
      title: d.title,
      message: d.message,
      deviceId: d.deviceId,
      deviceName: d.deviceName,
    })).sort((a, b) => b.t - a.t);
  }

  /* ------------------------------------------------------------------ */
  /* Polling                                                             */
  /* ------------------------------------------------------------------ */

  async tick() {
    if (this.tickBusy) return;
    this.tickBusy = true;
    try {
      if (this.mode === 'demo') await this.tickDemo();
      else await this.tickLive();
      this.evaluateTransitions();
      this.emit('snapshot');
    } catch (err) {
      this.pushEvent('warning', 'Gagal memperbarui data', err.message);
    } finally {
      this.tickBusy = false;
    }
  }

  async tickDemo() {
    stepDemo(this.devices, this.config.thresholds);
    const now = Date.now();
    const down = this.devices.reduce((sum, d) => sum + (d.status === 'down' ? 0 : d.downMbps), 0);
    const up = this.devices.reduce((sum, d) => sum + (d.status === 'down' ? 0 : d.upMbps), 0);
    this.pushTraffic(now, down * 1.04, up * 1.04);

    for (const device of this.devices) {
      device.availability = device.totalSamples ? round((device.upSamples / device.totalSamples) * 100, 2) : 100;
      device.history.push({
        t: now,
        latency: device.latency,
        loss: device.loss,
        down: round(device.downMbps, 2),
        up: round(device.upMbps, 2),
        status: device.status,
      });
      if (device.history.length > 90) device.history.shift();
    }

    if (Math.random() < 0.6) {
      for (const entry of demoTickActivity(DEMO_CLIENTS, 1)) this.addDemoActivity(entry);
    }
    if (Math.random() < 0.25) {
      this.wifi.current.signal = clamp(Math.round(this.wifi.current.signal + rand(-1, 1)), 84, 99);
    }

    const wifiEvery = Number(this.config.wifi && this.config.wifi.scanIntervalMs) || 20000;
    if (!this.demoWifiAt || now - this.demoWifiAt >= wifiEvery) {
      this.demoWifiAt = now;
      this.wifi.scannedAt = now;
      this.wifi.nearby = this.wifi.nearby.map((n) => ({
        ...n,
        signal: clamp(Math.round(n.signal + rand(-2, 2)), 5, 99),
      }));
    }

    const clientsEvery = Number(this.config.wifi && this.config.wifi.clientRefreshMs) || 30000;
    if (!this.demoClientsAt || now - this.demoClientsAt >= clientsEvery) {
      this.demoClientsAt = now;
      this.clients.scannedAt = now;
      this.clients.list = this.clients.list.map((c) => ({
        ...c,
        lastSeen: c.status === 'online' ? now - Math.round(rand(0, 4000)) : now - Math.round(rand(300000, 900000)),
      }));
    }
  }

  async tickLive() {
    const gateway = await net.getDefaultGateway();
    const targets = this.devices.map((d) => (d.host === 'auto' ? gateway.gateway : d.host));
    const unique = [...new Set(targets.filter(Boolean))];
    const results = unique.length ? await net.pingAll(unique, 1100, 6) : new Map();
    const throughput = await net.getNicThroughput();
    const now = Date.now();
    const limit = Number(this.config.thresholds.latencyMs) || 120;
    const lossLimit = Number(this.config.thresholds.lossPct) || 5;

    this.devices.forEach((device, index) => {
      const host = targets[index];
      const result = host ? results.get(host) : null;
      device.resolvedHost = host || null;
      device.lastCheck = now;
      device.totalSamples += 1;

      if (!host || !result || !result.up) {
        device.status = 'down';
        device.latency = null;
        device.loss = 100;
        device.downMbps = null;
        device.upMbps = null;
        if (!device.downSince) device.downSince = now;
      } else {
        device.status = result.latency > limit ? 'warning' : 'up';
        device.latency = result.latency;
        device.upSamples += 1;
        device.recent.push(true);
        if (device.recent.length > 30) device.recent.shift();
        const losses = device.recent.filter((x) => !x).length;
        device.loss = round((losses / device.recent.length) * 100, 1);
        device.availability = round((device.upSamples / device.totalSamples) * 100, 2);
        if (device.loss > lossLimit && device.status === 'up') device.status = 'warning';
      }

      if (device.status === 'down') {
        device.recent.push(false);
        if (device.recent.length > 30) device.recent.shift();
      }

      device.history.push({
        t: now,
        latency: device.latency,
        loss: device.loss,
        down: null,
        up: null,
        status: device.status,
      });
      if (device.history.length > 90) device.history.shift();
    });

    const rx = throughput.rxMbps == null ? this.liveSeen.rx : throughput.rxMbps;
    const tx = throughput.txMbps == null ? this.liveSeen.tx : throughput.txMbps;
    this.liveSeen = { rx: rx == null ? 0 : rx, tx: tx == null ? 0 : tx };
    this.pushTraffic(now, rx || 0, tx || 0);

    if (now - this.lastWifiScan > (this.config.wifi.scanIntervalMs || 20000) && !this.wifiScanning) {
      this.lastWifiScan = now;
      this.scanWifi(false).catch(() => {});
    }
    if (now - this.lastClientRefresh > (this.config.wifi.clientRefreshMs || 30000) && !this.clientScanning) {
      this.lastClientRefresh = now;
      this.scanClients(false).catch(() => {});
    }
  }

  pushTraffic(t, down, up) {
    this.traffic.push({ t, down: round(Math.max(0, down), 2), up: round(Math.max(0, up), 2) });
    if (this.traffic.length > 150) this.traffic.shift();
  }

  /* ------------------------------------------------------------------ */
  /* Events & notifications                                              */
  /* ------------------------------------------------------------------ */

  pushEvent(level, title, message, device = null) {
    const event = {
      id: uid('evt'),
      t: Date.now(),
      level,
      title,
      message,
      deviceId: device ? device.id : null,
      deviceName: device ? device.name : null,
    };
    this.events.unshift(event);
    if (this.events.length > 60) this.events.length = 60;
    return event;
  }

  canNotify(device, kind) {
    const cooldown = (Number(this.config.thresholds.cooldownSec) || 60) * 1000;
    const key = `${device.id}:${kind}`;
    const last = this.alertCooldown.get(key) || 0;
    if (Date.now() - last < cooldown) return false;
    this.alertCooldown.set(key, Date.now());
    return true;
  }

  evaluateTransitions() {
    for (const device of this.devices) {
      const prev = device.prevStatus;
      if (prev && prev !== device.status) {
        if (device.status === 'down') {
          const message = `Tidak merespons ping. Lokasi: ${device.location}. Periksa daya, kabel, atau uplink perangkat.`;
          this.pushEvent('critical', 'Perangkat offline', message, device);
          if (this.canNotify(device, 'down')) {
            this.notifier
              .sendEvent({ title: 'PERANGKAT OFFLINE', message, level: 'critical', device: { name: device.name, host: device.resolvedHost || device.host } })
              .catch(() => {});
          }
        } else if (prev === 'down') {
          const downtime = device.downSince ? Date.now() - device.downSince : 0;
          device.downSince = null;
          const message = `Perangkat kembali merespons${downtime ? ` setelah ${durationText(downtime)}` : ''}.`;
          this.pushEvent('success', 'Perangkat pulih', message, device);
          if (this.config.thresholds.notifyRecovery !== false && this.canNotify(device, 'recovery')) {
            this.notifier
              .sendEvent({ title: 'PERANGKAT PULIH', message, level: 'success', device: { name: device.name, host: device.resolvedHost || device.host } })
              .catch(() => {});
          }
        } else if (device.status === 'warning') {
          const message = `Latensi ${device.latency == null ? '-' : `${round(device.latency, 0)} ms`} / loss ${device.loss}% melewati ambang batas.`;
          this.pushEvent('warning', 'Kualitas koneksi menurun', message, device);
          if (this.canNotify(device, 'warning')) {
            this.notifier
              .sendEvent({ title: 'LATENSI TINGGI', message, level: 'warning', device: { name: device.name, host: device.resolvedHost || device.host } })
              .catch(() => {});
          }
        }
      }
      device.prevStatus = device.status;
    }
  }

  async triggerIncident() {
    if (this.mode !== 'demo') {
      return { ok: false, error: 'Simulasi gangguan hanya tersedia di mode demo.' };
    }
    const candidates = this.devices.filter((d) => d.status !== 'down');
    if (!candidates.length) return { ok: false, error: 'Semua perangkat sudah offline.' };
    const device = pick(candidates);
    device.downUntil = Date.now() + 14000;
    device.lastOutageAt = Date.now();
    device.downSince = null;
    this.pushEvent('warning', 'Simulasi gangguan dijalankan', `${device.name} dibuat tidak merespons selama 14 detik.`, device);
    setTimeout(() => this.tick(), 300);
    return { ok: true, device: device.name };
  }

  /* ------------------------------------------------------------------ */
  /* Wi-Fi, clients, DNS                                                 */
  /* ------------------------------------------------------------------ */

  async scanWifi(force = false) {
    if (this.wifiScanning) return { ok: false, error: 'Pemindaian Wi-Fi sedang berjalan.' };
    this.wifiScanning = true;
    this.wifi.scanning = true;
    this.emit('snapshot');
    try {
      if (this.mode === 'demo') {
        await new Promise((r) => setTimeout(r, 650));
        this.wifi.nearby = DEMO_NEARBY.map((n) => ({
          ...n,
          signal: clamp(Math.round(n.signal + rand(-2, 2)), 5, 99),
          stations: n.stations == null ? null : Math.max(0, n.stations + (Math.random() < 0.15 ? (Math.random() < 0.5 ? -1 : 1) : 0)),
        }));
        this.wifi.current = { ...DEMO_CURRENT };
        this.wifi.scannedAt = Date.now();
        this.wifi.source = 'demo';
        this.wifi.error = null;
        return { ok: true, source: 'demo', networks: this.wifi.nearby.length };
      }

      const res = await wifi.scanNetworks(force);
      const current = res.current || null;
      if (current && current.ssid) {
        const match = res.networks.find((n) => n.ssid === current.ssid);
        current.stations = match ? match.stations : null;
        current.utilization = match ? match.utilization : null;
      }
      this.wifi.current = current;
      this.wifi.nearby = res.networks;
      this.wifi.scannedAt = res.scannedAt || Date.now();
      this.wifi.source = 'windows';
      this.wifi.error = res.error || null;
      this.lastWifiScan = Date.now();
      return { ok: true, source: 'windows', networks: res.networks.length };
    } catch (err) {
      this.wifi.error = err.message;
      return { ok: false, error: err.message };
    } finally {
      this.wifiScanning = false;
      this.wifi.scanning = false;
      this.emit('snapshot');
    }
  }

  async scanClients(deep = true) {
    if (this.clientScanning) return { ok: false, error: 'Pemindaian klien sedang berjalan.' };
    this.clientScanning = true;
    this.clients.scanning = true;
    this.emit('snapshot');
    try {
      if (this.mode === 'demo') {
        await new Promise((r) => setTimeout(r, 900));
        this.clients = {
          list: DEMO_CLIENTS.map((c) => ({ ...c, lastSeen: Date.now() })),
          scannedAt: Date.now(),
          scanning: false,
          subnet: '192.168.1.0/24',
          localIp: '192.168.1.68',
          gateway: '192.168.1.1',
          deep: true,
          count: DEMO_CLIENTS.length,
        };
        return { ok: true, source: 'demo', count: DEMO_CLIENTS.length };
      }
      const res = await wifi.scanClients({ deep, current: this.wifi.current });
      this.clients = { ...res, scanning: false };
      this.lastClientRefresh = Date.now();
      return { ok: true, source: 'windows', count: res.list.length };
    } catch (err) {
      return { ok: false, error: err.message };
    } finally {
      this.clientScanning = false;
      this.clients.scanning = false;
      this.emit('snapshot');
    }
  }

  async setDns(enabled) {
    if (enabled) {
      const res = await this.dns.start();
      if (!res.ok) return res;
      this.config.dns.enabled = true;
      this.pushEvent('info', 'DNS logger aktif', `Mendengarkan di port ${res.port}, diteruskan ke ${res.upstream}.`);
    } else {
      this.dns.stop();
      this.config.dns.enabled = false;
      this.pushEvent('info', 'DNS logger berhenti', 'Tidak ada lagi permintaan DNS yang dicatat.');
    }
    this.emit('snapshot');
    return { ok: true, running: this.dns.running };
  }

  async setMode(mode) {
    if (!['demo', 'live'].includes(mode)) return { ok: false, error: 'Mode tidak dikenal.' };
    if (mode === this.mode) return { ok: true, mode };
    this.initMode(mode);
    this.restartTimer();
    this.config.demoMode = mode === 'demo';
    this.tick();
    if (mode === 'live') {
      this.scanWifi(true).catch(() => {});
      this.scanClients(true).catch(() => {});
    }
    this.emit('snapshot');
    return { ok: true, mode };
  }

  /* ------------------------------------------------------------------ */
  /* Snapshot                                                            */
  /* ------------------------------------------------------------------ */

  activitySnapshot() {
    if (this.mode === 'demo') {
      return {
        enabled: true,
        source: 'demo',
        port: null,
        upstream: null,
        error: null,
        entries: this.demoActivity,
        stats: demoStats(this.demoStore),
      };
    }
    const snap = this.dns.snapshot();
    return {
      ...snap,
      source: 'dns',
      entries: snap.entries.map((entry) => {
        const client = this.clients.list.find((c) => c.ip === entry.clientIp);
        return { ...entry, clientName: client ? client.name : entry.clientIp };
      }),
    };
  }

  publicConfig() {
    const tg = this.config.telegram || {};
    const wa = this.config.whatsapp || {};
    return {
      telegram: {
        enabled: Boolean(tg.enabled),
        configured: Boolean(tg.botToken && tg.chatId),
        chatId: mask(tg.chatId),
        tokenSet: Boolean(tg.botToken),
      },
      whatsapp: {
        enabled: Boolean(wa.enabled),
        configured: Boolean(wa.provider && wa.token && wa.target),
        provider: wa.provider || 'generic',
        target: mask(wa.target),
        tokenSet: Boolean(wa.token),
        url: wa.url || '',
      },
      thresholds: {
        latencyMs: Number(this.config.thresholds.latencyMs) || 120,
        lossPct: Number(this.config.thresholds.lossPct) || 5,
        cooldownSec: Number(this.config.thresholds.cooldownSec) || 60,
        notifyRecovery: this.config.thresholds.notifyRecovery !== false,
      },
      dns: {
        enabled: this.dns.running,
        port: Number(this.config.dns.port) || 5354,
        upstream: this.config.dns.upstream || '8.8.8.8',
      },
    };
  }

  snapshot() {
    const now = Date.now();
    const online = this.devices.filter((d) => d.status !== 'down').length;
    const warning = this.devices.filter((d) => d.status === 'warning').length;
    const offline = this.devices.length - online;
    const measured = this.devices.filter((d) => d.latency != null);
    const avgLatency = measured.length
      ? round(measured.reduce((sum, d) => sum + d.latency, 0) / measured.length, 1)
      : null;
    const avgLoss = this.devices.length
      ? round(this.devices.reduce((sum, d) => sum + (d.loss || 0), 0) / this.devices.length, 2)
      : 0;
    const totalSamples = this.devices.reduce((sum, d) => sum + d.totalSamples, 0);
    const upSamples = this.devices.reduce((sum, d) => sum + d.upSamples, 0);
    const availability = totalSamples ? round((upSamples / totalSamples) * 100, 2) : 100;
    const last = this.traffic[this.traffic.length - 1] || { down: 0, up: 0 };
    const current = this.wifi.current || {};
    const nearby = this.wifi.nearby || [];
    const stationSource = current.stations != null ? current : nearby.find((n) => n.ssid === current.ssid);
    const stations = stationSource && stationSource.stations != null ? stationSource.stations : null;
    const activity = this.activitySnapshot();

    return {
      mode: this.mode,
      serverTime: now,
      startedAt: this.startedAt,
      kpi: {
        total: this.devices.length,
        online,
        offline,
        warning,
        avgLatency,
        avgLoss,
        availability,
        down: last.down,
        up: last.up,
        stations,
        status: offline > 0 ? 'critical' : warning > 0 ? 'degraded' : 'healthy',
      },
      devices: this.devices.map((d) => ({
        id: d.id,
        name: d.name,
        host: d.host,
        resolvedHost: d.resolvedHost,
        type: d.type,
        location: d.location,
        status: d.status,
        latency: d.latency,
        loss: d.loss,
        downMbps: d.downMbps,
        upMbps: d.upMbps,
        availability: d.availability,
        lastCheck: d.lastCheck,
        downSince: d.downSince,
        history: d.history.slice(-60),
      })),
      traffic: this.traffic,
      events: this.events.slice(0, 30),
      wifi: {
        current: this.wifi.current,
        nearby,
        scannedAt: this.wifi.scannedAt,
        source: this.wifi.source,
        scanning: this.wifiScanning,
        error: this.wifi.error,
      },
      clients: {
        ...this.clients,
        count: this.clients.list.length,
        stations,
      },
      activity,
      alerts: this.notifier.log.slice(0, 30),
      config: this.publicConfig(),
      system: {
        hostname: os.hostname(),
        platform: `${os.type()} ${os.release()}`,
        node: process.version,
        uptimeSec: Math.round(process.uptime()),
      },
    };
  }
}

module.exports = { Monitor, PALETTE };

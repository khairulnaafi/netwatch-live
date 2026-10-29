'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { Monitor } = require('./lib/monitor');
const { DEFAULTS } = require('./lib/defaults');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const CONFIG_PATH = process.env.NETWATCH_CONFIG || path.join(ROOT, 'config.json');
const OPEN_BROWSER = !process.argv.includes('--no-open');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function mergeDefaults(base, value) {
  if (Array.isArray(base)) return Array.isArray(value) ? value : base;
  if (base && typeof base === 'object') {
    const out = {};
    for (const key of Object.keys(base)) out[key] = mergeDefaults(base[key], value ? value[key] : undefined);
    if (value && typeof value === 'object') {
      for (const key of Object.keys(value)) if (!(key in out)) out[key] = value[key];
    }
    return out;
  }
  return value === undefined || value === null ? base : value;
}

function loadConfig() {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8').replace(/^\uFEFF/, '');
    const parsed = JSON.parse(raw);
    return mergeDefaults(DEFAULTS, parsed);
  } catch (err) {
    console.error(`[config] Tidak bisa membaca config.json: ${err.message}`);
    console.error('[config] Memakai konfigurasi default.');
    return mergeDefaults(DEFAULTS, {});
  }
}

function saveConfig(config) {
  fs.writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

const config = loadConfig();
if (process.env.NETWATCH_DEMO === '1') config.demoMode = true;
if (process.env.NETWATCH_DEMO === '0') config.demoMode = false;
const monitor = new Monitor(config);
const PORT = Number(process.env.PORT) || config.port;

/* -------------------------------------------------------------------- */
/* SSE                                                                   */
/* -------------------------------------------------------------------- */

const sseClients = new Set();

function sendSnapshot(res, snapshot) {
  const payload = JSON.stringify(snapshot);
  res.write(`event: snapshot\ndata: ${payload}\n\n`);
}

monitor.on('snapshot', () => {
  if (!sseClients.size) return;
  const payload = JSON.stringify(monitor.snapshot());
  for (const res of sseClients) {
    try {
      res.write(`event: snapshot\ndata: ${payload}\n\n`);
    } catch (_) {
      sseClients.delete(res);
    }
  }
});

setInterval(() => {
  for (const res of sseClients) {
    try {
      res.write(': ping\n\n');
    } catch (_) {
      sseClients.delete(res);
    }
  }
}, 15000).unref();

/* -------------------------------------------------------------------- */
/* Helpers                                                               */
/* -------------------------------------------------------------------- */

function json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 128 * 1024) {
        reject(new Error('Body terlalu besar.'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (_) {
        reject(new Error('JSON tidak valid.'));
      }
    });
    req.on('error', reject);
  });
}

function numberIn(value, fallback, min, max) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, num));
}

function safeString(value, max = 500) {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

function serveStatic(req, res, pathname) {
  let relative = decodeURIComponent(pathname);
  if (relative === '/' || relative === '') relative = '/index.html';
  const filePath = path.normalize(path.join(PUBLIC_DIR, relative));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Halaman tidak ditemukan.');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=60',
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

/* -------------------------------------------------------------------- */
/* HTTP server                                                           */
/* -------------------------------------------------------------------- */

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'"
  );

  try {
    if (pathname === '/api/stream') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      res.write('retry: 2000\n\n');
      sendSnapshot(res, monitor.snapshot());
      sseClients.add(res);
      req.on('close', () => sseClients.delete(res));
      return;
    }

    if (pathname === '/api/state' && req.method === 'GET') {
      return json(res, 200, monitor.snapshot());
    }

    if (pathname === '/api/health' && req.method === 'GET') {
      return json(res, 200, {
        ok: true,
        uptimeSec: Math.round(process.uptime()),
        mode: monitor.mode,
        sseClients: sseClients.size,
      });
    }

    if (pathname === '/api/mode' && req.method === 'POST') {
      const body = await readBody(req);
      const result = await monitor.setMode(safeString(body.mode, 10));
      if (result.ok) {
        config.demoMode = monitor.mode === 'demo';
        saveConfig(config);
      }
      return json(res, result.ok ? 200 : 400, result);
    }

    if (pathname === '/api/incident' && req.method === 'POST') {
      const result = await monitor.triggerIncident();
      return json(res, result.ok ? 200 : 400, result);
    }

    if (pathname === '/api/scan/wifi' && req.method === 'POST') {
      const result = await monitor.scanWifi(true);
      return json(res, result.ok ? 200 : 500, result);
    }

    if (pathname === '/api/scan/clients' && req.method === 'POST') {
      const result = await monitor.scanClients(true);
      return json(res, result.ok ? 200 : 500, result);
    }

    if (pathname === '/api/dns' && req.method === 'POST') {
      const body = await readBody(req);
      const enabled = Boolean(body.enabled);
      const result = await monitor.setDns(enabled);
      if (result.ok) {
        config.dns.enabled = enabled;
        saveConfig(config);
      }
      return json(res, result.ok ? 200 : 500, result);
    }

    if (pathname === '/api/notify/test' && req.method === 'POST') {
      const body = await readBody(req);
      const channel = safeString(body.channel, 20);
      if (!['telegram', 'whatsapp'].includes(channel)) {
        return json(res, 400, { ok: false, error: 'Channel tidak dikenal.' });
      }
      const result = await monitor.notifier.test(channel);
      return json(res, result.ok ? 200 : 400, result);
    }

    if (pathname === '/api/config' && req.method === 'POST') {
      const body = await readBody(req);

      if (body.telegram && typeof body.telegram === 'object') {
        const tg = body.telegram;
        if (typeof tg.enabled === 'boolean') config.telegram.enabled = tg.enabled;
        if (tg.clearToken) config.telegram.botToken = '';
        else if (safeString(tg.botToken)) config.telegram.botToken = safeString(tg.botToken, 200).trim();
        if (safeString(tg.chatId)) config.telegram.chatId = safeString(tg.chatId, 80).trim();
      }

      if (body.whatsapp && typeof body.whatsapp === 'object') {
        const wa = body.whatsapp;
        if (typeof wa.enabled === 'boolean') config.whatsapp.enabled = wa.enabled;
        if (['generic', 'fonnte', 'wablas', 'meta'].includes(wa.provider)) config.whatsapp.provider = wa.provider;
        if (wa.clearToken) config.whatsapp.token = '';
        else if (safeString(wa.token)) config.whatsapp.token = safeString(wa.token, 400).trim();
        if (safeString(wa.target)) config.whatsapp.target = safeString(wa.target, 80).trim();
        if (typeof wa.url === 'string') config.whatsapp.url = safeString(wa.url, 400).trim();
        if (typeof wa.phoneNumberId === 'string') config.whatsapp.phoneNumberId = safeString(wa.phoneNumberId, 80).trim();
      }

      if (body.thresholds && typeof body.thresholds === 'object') {
        const th = body.thresholds;
        config.thresholds.latencyMs = numberIn(th.latencyMs, config.thresholds.latencyMs, 10, 5000);
        config.thresholds.lossPct = numberIn(th.lossPct, config.thresholds.lossPct, 0, 100);
        config.thresholds.cooldownSec = numberIn(th.cooldownSec, config.thresholds.cooldownSec, 10, 3600);
        if (typeof th.notifyRecovery === 'boolean') config.thresholds.notifyRecovery = th.notifyRecovery;
      }

      saveConfig(config);
      monitor.emit('snapshot');
      return json(res, 200, { ok: true, config: monitor.publicConfig() });
    }

    if (pathname.startsWith('/api/')) {
      return json(res, 404, { ok: false, error: 'Endpoint tidak ditemukan.' });
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return json(res, 405, { ok: false, error: 'Method tidak diizinkan.' });
    }

    return serveStatic(req, res, pathname);
  } catch (err) {
    console.error('[http]', err);
    return json(res, 500, { ok: false, error: err.message });
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\nPort ${PORT} sudah dipakai. Ubah "port" di config.json atau hentikan proses lain.\n`);
  } else {
    console.error('[server]', err);
  }
  process.exit(1);
});

const host = process.env.HOST || config.host || '127.0.0.1';
server.listen(PORT, host, () => {
  const url = `http://${host === '0.0.0.0' ? 'localhost' : host}:${PORT}`;
  console.log('');
  console.log('  NETWATCH LIVE - Network Monitoring Dashboard');
  console.log(`  ${url}`);
  console.log(`  Mode awal: ${monitor.mode} | Data: ${CONFIG_PATH}`);
  console.log('  Tekan Ctrl+C untuk berhenti.');
  console.log('');
  monitor.start();

  if (OPEN_BROWSER && process.platform === 'win32') {
    execFile('cmd', ['/c', 'start', '', url], { windowsHide: true }, () => {});
  }
});

function shutdown() {
  console.log('\n[server] Menghentikan pemantauan...');
  monitor.stop();
  for (const res of sseClients) {
    try { res.end(); } catch (_) {}
  }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

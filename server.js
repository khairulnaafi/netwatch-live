'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { Monitor } = require('./lib/monitor');
const { DEFAULTS } = require('./lib/defaults');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const CONFIG_PATH = process.env.NETWATCH_CONFIG || path.join(ROOT, 'config.json');
const OPEN_BROWSER = !process.argv.includes('--no-open');
const AUTH_USER = process.env.NETWATCH_USER || '';
const AUTH_PASS = process.env.NETWATCH_PASS || '';
const AUTH_TOKEN =
  AUTH_USER && AUTH_PASS
    ? crypto.createHash('sha256').update(`${AUTH_USER}:${AUTH_PASS}`).digest('hex').slice(0, 32)
    : '';

function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    out[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return out;
}

function basicOk(req) {
  const [scheme, encoded] = String(req.headers.authorization || '').split(' ');
  if (scheme !== 'Basic' || !encoded) return false;
  let decoded;
  try {
    decoded = Buffer.from(encoded, 'base64').toString('utf8');
  } catch (_) {
    return false;
  }
  const index = decoded.indexOf(':');
  if (index < 0) return false;
  const user = decoded.slice(0, index);
  const pass = decoded.slice(index + 1);
  const given = Buffer.from(`${user}:${pass}`);
  const expected = Buffer.from(`${AUTH_USER}:${AUTH_PASS}`);
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

function authOk(req, url) {
  if (!AUTH_USER && !AUTH_PASS) return true;
  if (!AUTH_USER || !AUTH_PASS) return false;
  if (basicOk(req)) return true;
  if (AUTH_TOKEN && parseCookies(req).nw_session === AUTH_TOKEN) return true;
  if (AUTH_TOKEN && url && url.searchParams.get('k') === AUTH_TOKEN) return true;
  return false;
}

// Berkas agent yang boleh diunduh tanpa login (tidak berisi rahasia).
const PUBLIC_SCRIPTS = {
  '/agent/setup.sh': 'termux-setup.sh',
  '/agent/termux.sh': 'termux.sh',
  '/agent/agent.sh': 'agent.sh',
};

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
const AGENT_KEY = process.env.NETWATCH_AGENT_KEY || (config.agent && config.agent.key) || '';

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

function sendFile(res, filePath, type, req) {
  let data;
  try {
    data = fs.readFileSync(filePath);
  } catch (_) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Berkas tidak ditemukan.');
  }
  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': data.length,
    'Cache-Control': 'no-store',
  });
  return res.end(req && req.method === 'HEAD' ? undefined : data);
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
  let relative;
  try {
    relative = decodeURIComponent(pathname);
  } catch (_) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Path tidak valid.');
    return;
  }
  if (relative === '/' || relative === '') relative = '/index.html';
  if (relative.includes('\0')) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Path tidak valid.');
    return;
  }
  const filePath = path.normalize(path.join(PUBLIC_DIR, relative));
  if (filePath !== PUBLIC_DIR && !filePath.startsWith(PUBLIC_DIR + path.sep)) {
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

/**
 * Parse URL permintaan dengan aman. Proksi/tunnel kadang mengirim path aneh
 * seperti "//" yang membuat `new URL()` melempar error dan mematikan proses.
 */
function requestUrl(req) {
  const raw = String(req.url || '/');
  const host = String(req.headers.host || 'localhost').replace(/[^A-Za-z0-9.:\-\[\]]/g, '');
  try {
    if (/^https?:\/\//i.test(raw)) return new URL(raw);
    return new URL(`http://${host}${raw.startsWith('/') ? raw : `/${raw}`}`);
  } catch (_) {
    return null;
  }
}

// Jaring pengaman: satu promise yang gagal tidak boleh mematikan dashboard.
process.on('unhandledRejection', (err) => {
  console.error('[unhandled]', err && err.message ? err.message : err);
});

const server = http.createServer((req, res) => {
  handleRequest(req, res).catch((err) => {
    console.error('[http]', err);
    try {
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      }
      res.end('Terjadi kesalahan pada server.');
    } catch (_) {}
  });
});

async function handleRequest(req, res) {
  const url = requestUrl(req);
  if (!url) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Permintaan tidak valid.');
  }
  const pathname = url.pathname.replace(/^\/{2,}/, '/');

  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'"
  );

  // Endpoint agent: dipakai perangkat lain (laptop/HP teman) untuk mengirim
  // hasil scan Wi-Fi di sekitar mereka. Memakai kunci agent sendiri, bukan
  // password dashboard, supaya kredensial admin tidak perlu dibagikan.
  if (pathname === '/api/agent/ingest') {
    if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'Gunakan POST.' });
    if (!AGENT_KEY) {
      return json(res, 503, {
        ok: false,
        error: 'Mode agent belum aktif. Isi agent.key di config.json atau NETWATCH_AGENT_KEY.',
      });
    }
    const provided = String(req.headers['x-agent-key'] || url.searchParams.get('key') || '');
    const check = monitor.checkAgentKey(provided, AGENT_KEY);
    if (!check.ok) return json(res, 401, { ok: false, error: 'Kunci agent salah.' });

    try {
      const body = await readBody(req);
      // Kunci perangkat hanya boleh menulis ke lokasinya sendiri.
      if (check.boundId) body.id = check.boundId;
      const saved = monitor.ingestAgent(body);
      return json(res, 200, { ok: true, id: saved.id, name: saved.name });
    } catch (err) {
      return json(res, 400, { ok: false, error: err.message });
    }
  }

  // Halaman publik untuk teman: mendaftarkan perangkat lalu melihat Wi-Fi
  // di sekitarnya. Tidak memakai password dashboard.
  if (pathname === '/join' && (req.method === 'GET' || req.method === 'HEAD')) {
    return sendFile(res, path.join(PUBLIC_DIR, 'join.html'), 'text/html; charset=utf-8', req);
  }

  if (pathname === '/join.js' && (req.method === 'GET' || req.method === 'HEAD')) {
    return sendFile(res, path.join(PUBLIC_DIR, 'js', 'join.js'), 'text/javascript; charset=utf-8', req);
  }

  if (pathname === '/agent/netwatch-agent.zip' && (req.method === 'GET' || req.method === 'HEAD')) {
    return sendFile(res, path.join(ROOT, 'agent', 'netwatch-agent.zip'), 'application/zip', req);
  }

  if (pathname === '/api/agent/status' && req.method === 'GET') {
    const id = url.searchParams.get('id');
    const key = url.searchParams.get('key') || req.headers['x-agent-key'] || '';
    const check = monitor.checkAgentKey(key, AGENT_KEY);
    if (!check.ok) return json(res, 401, { ok: false, error: 'Sesi tidak valid.' });
    if (check.boundId && check.boundId !== String(id || '')) {
      return json(res, 403, { ok: false, error: 'Kunci tidak cocok dengan perangkat ini.' });
    }
    return json(res, 200, monitor.agentStatus(id));
  }

  if (pathname === '/api/agent/enroll' && req.method === 'POST') {
    if (!AGENT_KEY) {
      return json(res, 503, { ok: false, error: 'Mode agent belum aktif di server ini.' });
    }
    try {
      const body = await readBody(req);
      const info = monitor.enrollAgent(body && body.name);
      return json(res, 200, {
        ok: true,
        id: info.id,
        name: info.name,
        key: info.key,
        expiresAt: info.expiresAt,
      });
    } catch (err) {
      return json(res, 400, { ok: false, error: err.message });
    }
  }

  // Script agent publik: tidak berisi rahasia (kunci dikirim sebagai argumen),
  // supaya pengguna Android bisa menjalankan satu perintah di Termux.
  if (PUBLIC_SCRIPTS[pathname]) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return json(res, 405, { ok: false, error: 'Method tidak diizinkan.' });
    }
    return sendFile(res, path.join(ROOT, 'agent', PUBLIC_SCRIPTS[pathname]), 'text/plain; charset=utf-8', req);
  }

  if (!authOk(req, url)) {
    res.writeHead(401, {
      'WWW-Authenticate': 'Basic realm="NetWatch Live", charset="UTF-8"',
      'Content-Type': 'text/plain; charset=utf-8',
    });
    return res.end('Autentikasi diperlukan.');
  }

  // Link akses sekali klik: /?k=<token> menyimpan sesi di cookie lalu
  // mengalihkan ke URL bersih supaya token tidak tertinggal di address bar.
  if (AUTH_TOKEN && url.searchParams.get('k') === AUTH_TOKEN && parseCookies(req).nw_session !== AUTH_TOKEN) {
    const secure = String(req.headers['x-forwarded-proto'] || '').includes('https') ? '; Secure' : '';
    res.setHeader('Set-Cookie', `nw_session=${AUTH_TOKEN}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${secure}`);
    const clean = new URL(url.href);
    clean.searchParams.delete('k');
    res.writeHead(302, { Location: `${clean.pathname}${clean.search}` });
    return res.end();
  }

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
}

server.on('clientError', (err, socket) => {
  if (socket.writable) {
    socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
  } else {
    socket.destroy();
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
  // Link admin sekali klik: membuka dashboard tanpa mengetik password.
  // Token diturunkan dari user:pass, jadi hanya berubah bila kredensial diganti.
  const adminUrl = AUTH_TOKEN ? `${url}/?k=${AUTH_TOKEN}` : url;
  console.log('');
  console.log('  NETWATCH LIVE - Network Monitoring Dashboard');
  console.log(`  ${url}`);
  if (AUTH_TOKEN) {
    console.log('');
    console.log('  Link admin (langsung masuk, tanpa login):');
    console.log(`  ${adminUrl}`);
    console.log('  Simpan sebagai bookmark. Berlaku 1 tahun di browser ini.');
  }
  console.log(`  Mode awal: ${monitor.mode} | Data: ${CONFIG_PATH}`);
  console.log('  Tekan Ctrl+C untuk berhenti.');
  console.log('');
  monitor.start();

  if (OPEN_BROWSER && process.platform === 'win32') {
    execFile('cmd', ['/c', 'start', '', adminUrl], { windowsHide: true }, () => {});
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

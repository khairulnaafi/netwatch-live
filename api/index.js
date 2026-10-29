'use strict';

/**
 * Vercel serverless adapter — DEMO SHOWCASE ONLY.
 *
 * Vercel tidak menjalankan proses Node terus-menerus, tidak punya filesystem
 * persisten, dan tidak bisa memakai perintah Windows (ping/netsh/arp) atau
 * DNS UDP. Karena itu deployment ini hanya menampilkan mode demo.
 *
 * Untuk monitoring live, jalankan server.js di VPS/Render/Railway/Fly.io.
 */

const { Monitor } = require('../lib/monitor');
const { DEFAULTS } = require('../lib/defaults');

const config = JSON.parse(JSON.stringify(DEFAULTS));
config.demoMode = true;
config.port = 0;
config.telegram.enabled = false;
config.whatsapp.enabled = false;
config.dns.enabled = false;

const monitor = new Monitor(config);
let lastTick = 0;

async function advance() {
  const now = Date.now();
  if (now - lastTick < 1500) return;
  lastTick = now;
  await monitor.tick();
}

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1e6) {
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

module.exports = async (req, res) => {
  let url;
  try {
    const host = String(req.headers.host || 'localhost').replace(/[^A-Za-z0-9.:\-\[\]]/g, '');
    const raw = String(req.url || '/');
    url = new URL(`http://${host}${raw.startsWith('/') ? raw : `/${raw}`}`);
  } catch (_) {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.end('Permintaan tidak valid.');
  }
  const pathname = url.pathname.replace(/^\/{2,}/, '/').replace(/\/+$/, '') || '/';

  try {
    if (pathname === '/api/state' && req.method === 'GET') {
      await advance();
      return json(res, 200, monitor.snapshot());
    }

    if (pathname === '/api/health' && req.method === 'GET') {
      return json(res, 200, {
        ok: true,
        uptimeSec: Math.round(process.uptime()),
        mode: 'demo',
        runtime: 'vercel',
        sseClients: 0,
      });
    }

    if (pathname === '/api/stream') {
      return json(res, 501, {
        ok: false,
        error: 'SSE tidak tersedia di Vercel. Dashboard memakai polling.',
      });
    }

    if (pathname === '/api/incident' && req.method === 'POST') {
      const result = await monitor.triggerIncident();
      await monitor.tick();
      return json(res, result.ok ? 200 : 400, result);
    }

    if (pathname === '/api/mode' && req.method === 'POST') {
      const body = await readBody(req);
      if (body.mode === 'demo') return json(res, 200, { ok: true, mode: 'demo' });
      return json(res, 400, {
        ok: false,
        error: 'Deployment Vercel hanya mendukung mode demo. Jalankan server.js di VPS untuk mode live.',
      });
    }

    if (pathname === '/api/scan/wifi' && req.method === 'POST') {
      await advance();
      return json(res, 200, { ok: true, networks: monitor.wifi.nearby.length });
    }

    if (pathname === '/api/scan/clients' && req.method === 'POST') {
      await advance();
      return json(res, 200, { ok: true, count: monitor.clients.list.length });
    }

    if (pathname === '/api/dns') {
      return json(res, 501, {
        ok: false,
        error: 'DNS logger UDP tidak tersedia di Vercel. Jalankan server.js secara lokal/VPS.',
      });
    }

    if (pathname === '/api/notify/test') {
      return json(res, 400, {
        ok: false,
        error: 'Kirim notifikasi tidak tersedia di demo Vercel. Konfigurasikan di server lokal/VPS.',
      });
    }

    if (pathname === '/api/config') {
      return json(res, 403, {
        ok: false,
        error: 'Konfigurasi bersifat read-only di demo Vercel.',
      });
    }

    if (pathname === '/api/agent/enroll') {
      return json(res, 503, {
        ok: false,
        error: 'Pendaftaran perangkat hanya tersedia di server live. Ini hanya demo.',
      });
    }

    if (pathname === '/api/agent/status') {
      return json(res, 200, { ok: true, found: false, online: false });
    }

    if (pathname.startsWith('/api/')) {
      return json(res, 404, { ok: false, error: 'Endpoint tidak ditemukan.' });
    }

    return json(res, 404, { ok: false, error: 'Gunakan halaman utama untuk membuka dashboard.' });
  } catch (err) {
    return json(res, 500, { ok: false, error: err.message });
  }
};

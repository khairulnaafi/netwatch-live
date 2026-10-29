'use strict';

const DEFAULTS = {
  port: 8787,
  host: '127.0.0.1',
  demoMode: true,
  tickMs: 2000,
  liveTickMs: 3000,
  telegram: { enabled: false, botToken: '', chatId: '' },
  whatsapp: { enabled: false, provider: 'generic', url: '', token: '', target: '', phoneNumberId: '' },
  thresholds: { latencyMs: 120, lossPct: 5, cooldownSec: 60, notifyRecovery: true },
  liveDevices: [
    { id: 'gateway', name: 'Gateway Lokal', host: 'auto', type: 'router', location: 'Jaringan lokal' },
    { id: 'cloudflare', name: 'Cloudflare DNS', host: '1.1.1.1', type: 'cloud', location: 'Internet' },
    { id: 'google', name: 'Google DNS', host: '8.8.8.8', type: 'cloud', location: 'Internet' },
  ],
  dns: { enabled: false, port: 5354, upstream: '8.8.8.8' },
  wifi: { scanIntervalMs: 20000, clientRefreshMs: 30000 },
  agent: { enabled: true, key: '' },
};

module.exports = { DEFAULTS };

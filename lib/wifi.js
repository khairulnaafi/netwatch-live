'use strict';

const { execFileP } = require('./util');
const {
  getIpConfig,
  pingSweep,
  listArp,
  isUnicastMac,
  macVendor,
} = require('./network');

function num(value) {
  if (value == null) return null;
  const match = String(value).match(/-?\d+(?:[.,]\d+)?/);
  if (!match) return null;
  return Number(match[0].replace(',', '.'));
}

/**
 * Parses `netsh wlan show networks mode=bssid` (English + Indonesian labels).
 */
function parseNetworks(text) {
  const networks = [];
  let current = null;
  let bss = null;

  const pushBss = () => {
    if (current && bss) current.bssids.push(bss);
    bss = null;
  };
  const pushNetwork = () => {
    pushBss();
    if (current) networks.push(current);
    current = null;
  };

  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;

    const ssidMatch = line.match(/^SSID\s+\d+\s*:\s*(.*)$/i);
    if (ssidMatch) {
      pushNetwork();
      const name = ssidMatch[1].trim();
      current = {
        ssid: name || '(SSID tersembunyi)',
        auth: null,
        cipher: null,
        bssids: [],
      };
      continue;
    }

    if (!current) continue;

    const bssidMatch = line.match(/^BSSID\s+\d+\s*:\s*([0-9a-f:.-]+)/i);
    if (bssidMatch) {
      pushBss();
      bss = {
        bssid: bssidMatch[1].toLowerCase().replace(/-/g, ':'),
        signal: null,
        channel: null,
        band: null,
        radio: null,
        stations: null,
        utilization: null,
      };
      continue;
    }

    if (/^(Authentication|Autentikasi)\s*:/i.test(line)) {
      current.auth = line.split(':').slice(1).join(':').trim();
      continue;
    }
    if (/^(Encryption|Enkripsi)\s*:/i.test(line)) {
      current.cipher = line.split(':').slice(1).join(':').trim();
      continue;
    }
    if (!bss) continue;

    if (/^(Signal|Sinyal)\s*:/i.test(line)) {
      bss.signal = num(line.split(':').slice(1).join(':'));
    } else if (/^(Channel|Saluran)\s*:/i.test(line)) {
      bss.channel = num(line.split(':').slice(1).join(':'));
    } else if (/^(Band|Pita)\s*:/i.test(line)) {
      bss.band = line.split(':').slice(1).join(':').trim();
    } else if (/^(Radio type|Tipe radio)\s*:/i.test(line)) {
      bss.radio = line.split(':').slice(1).join(':').trim();
    } else if (/^(Connected Stations|Stasiun Terhubung)\s*:/i.test(line)) {
      bss.stations = num(line.split(':').slice(1).join(':'));
    } else if (/^(Channel Utilization|Utilisasi Saluran)\s*:/i.test(line)) {
      const util = line.match(/\((\d+)\s*%\)/);
      bss.utilization = util ? Number(util[1]) : num(line.split(':').slice(1).join(':'));
    }
  }
  pushNetwork();

  const bySsid = new Map();
  for (const net of networks) {
    if (!net.bssids.length) {
      net.bssids.push({
        bssid: null, signal: null, channel: null, band: null, radio: null, stations: null, utilization: null,
      });
    }
    const strongest = net.bssids.reduce((a, b) => ((b.signal || 0) > (a.signal || 0) ? b : a));
    const item = {
      ssid: net.ssid,
      bssid: strongest.bssid,
      signal: strongest.signal,
      channel: strongest.channel,
      band: strongest.band,
      radio: strongest.radio,
      stations: strongest.stations,
      utilization: strongest.utilization,
      auth: net.auth || 'Tidak diketahui',
      cipher: net.cipher || 'Tidak diketahui',
      security: /open|terbuka|none|tidak ada/i.test(`${net.auth} ${net.cipher}`)
        ? 'Terbuka'
        : /wpa3/i.test(`${net.auth} ${net.cipher}`)
        ? 'WPA3'
        : /wpa2/i.test(`${net.auth} ${net.cipher}`)
        ? 'WPA2'
        : 'WPA',
      bssids: net.bssids,
    };
    const existing = bySsid.get(item.ssid);
    if (!existing || (item.signal || 0) > (existing.signal || 0)) bySsid.set(item.ssid, item);
  }
  return Array.from(bySsid.values()).sort((a, b) => (b.signal || 0) - (a.signal || 0));
}

function parseInterface(text) {
  const result = {
    name: null,
    state: null,
    ssid: null,
    bssid: null,
    band: null,
    channel: null,
    signal: null,
    rssi: null,
    rxMbps: null,
    txMbps: null,
    auth: null,
    cipher: null,
    radio: null,
    mac: null,
    connected: false,
  };
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    const kv = line.split(':');
    if (kv.length < 2) continue;
    const key = kv[0].trim().toLowerCase();
    const value = kv.slice(1).join(':').trim();
    if (key === 'name' || key === 'nama') result.name = value;
    else if (key === 'state' || key === 'status') result.state = value;
    else if (key === 'ssid') result.ssid = value;
    else if (key === 'ap bssid') result.bssid = value.toLowerCase().replace(/-/g, ':');
    else if (key === 'band' || key === 'pita') result.band = value;
    else if (key === 'channel' || key === 'saluran') result.channel = num(value);
    else if (key === 'signal' || key === 'sinyal') result.signal = num(value);
    else if (key === 'rssi') result.rssi = num(value);
    else if (/receive rate/i.test(key)) result.rxMbps = num(value);
    else if (/transmit rate/i.test(key)) result.txMbps = num(value);
    else if (key === 'authentication' || key === 'autentikasi') result.auth = value;
    else if (key === 'cipher' || key === 'enkripsi') result.cipher = value;
    else if (key === 'radio type' || key === 'tipe radio') result.radio = value;
    else if (key === 'physical address' || key === 'alamat fisik')
      result.mac = value.toLowerCase().replace(/-/g, ':');
  }
  result.connected = /connected|terhubung/i.test(result.state || '') && Boolean(result.ssid);
  return result;
}

async function currentConnection() {
  const res = await execFileP('netsh', ['wlan', 'show', 'interfaces'], { timeout: 8000 });
  return parseInterface(res.stdout);
}

let networkCache = { at: 0, networks: [] };

async function scanNetworks(force = false) {
  if (!force && Date.now() - networkCache.at < 10000) {
    return { networks: networkCache.networks, scannedAt: networkCache.at, cached: true };
  }
  const [netRes, current] = await Promise.all([
    execFileP('netsh', ['wlan', 'show', 'networks', 'mode=bssid'], { timeout: 12000 }),
    currentConnection(),
  ]);
  const networks = parseNetworks(netRes.stdout);
  networkCache = { at: Date.now(), networks };
  return { networks, current, scannedAt: networkCache.at, cached: false, error: netRes.ok ? null : 'netsh gagal' };
}

function clientName(entry, selfIp, gatewayIp, selfMac) {
  if (entry.mac === selfMac) return 'Komputer ini';
  if (gatewayIp && entry.ip === gatewayIp) return 'Gateway';
  const vendor = macVendor(entry.mac);
  return vendor && vendor !== 'Tidak diketahui' ? `Perangkat ${vendor}` : 'Perangkat klien';
}

async function scanClients({ deep = true, current = null } = {}) {
  const cfg = await getIpConfig();
  const subnet = cfg.localIp ? cfg.localIp.split('.').slice(0, 3).join('.') : null;
  let alive = new Set();
  if (deep && subnet) {
    const sweep = await pingSweep(subnet);
    alive = new Set(sweep.alive || []);
  }
  const arp = await listArp();
  const selfMac = current && current.mac ? current.mac : null;
  const seen = new Map();

  for (const entry of arp) {
    if (!isUnicastMac(entry.mac)) continue;
    if (entry.ip.endsWith('.255') || entry.ip.startsWith('224.') || entry.ip.startsWith('239.')) continue;
    if (subnet && !entry.ip.startsWith(`${subnet}.`)) continue;
    const prev = seen.get(entry.ip);
    if (prev) continue;
    const isSelf = selfMac && entry.mac === selfMac;
    const isGateway = cfg.gateway && entry.ip === cfg.gateway;
    seen.set(entry.ip, {
      ip: entry.ip,
      mac: entry.mac,
      vendor: macVendor(entry.mac),
      name: isSelf ? 'Komputer ini' : isGateway ? 'Gateway' : clientName(entry, cfg.localIp, cfg.gateway, selfMac),
      role: isSelf ? 'self' : isGateway ? 'gateway' : 'client',
      status: alive.size ? (alive.has(entry.ip) ? 'online' : 'idle') : entry.type === 'dynamic' ? 'online' : 'idle',
      lastSeen: Date.now(),
    });
  }

  const list = Array.from(seen.values()).sort((a, b) => {
    const rank = { gateway: 0, self: 1, client: 2 };
    if (rank[a.role] !== rank[b.role]) return rank[a.role] - rank[b.role];
    const na = Number(a.ip.split('.').pop());
    const nb = Number(b.ip.split('.').pop());
    return na - nb;
  });

  return {
    list,
    subnet: subnet ? `${subnet}.0/24` : null,
    subnetBase: subnet,
    localIp: cfg.localIp,
    gateway: cfg.gateway,
    scannedAt: Date.now(),
    deep,
    count: list.length,
  };
}

module.exports = {
  parseNetworks,
  parseInterface,
  scanNetworks,
  currentConnection,
  scanClients,
};

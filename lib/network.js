'use strict';

const { execFileP, sleep } = require('./util');

const IPV4_RE = /\b(\d{1,3}(?:\.\d{1,3}){3})\b/;

async function ping(host, timeoutMs = 1200) {
  if (!host || host === 'auto') return { up: false, latency: null, reason: 'no-host' };
  const started = Date.now();
  const res = await execFileP('ping', ['-n', '1', '-w', String(timeoutMs), host], {
    timeout: timeoutMs + 2500,
  });
  const out = res.stdout || '';
  const latencyMatch =
    out.match(/(?:time|waktu|tiempo|temps|zeit)[=<]\s*(\d+(?:[.,]\d+)?)\s*ms/i) ||
    out.match(/[=<]\s*(\d+(?:[.,]\d+)?)\s*ms/i);
  const hasTtl = /\bTTL[=:]/i.test(out);
  const timedOut = /(?:100%\s*(?:loss|hilang|verlust)|timed out|request timed out|destination host unreachable|tidak dapat menjangkau)/i.test(
    out
  );
  const up = res.ok && hasTtl && !timedOut;
  let latency = null;
  if (up) {
    latency = latencyMatch ? Number(String(latencyMatch[1]).replace(',', '.')) : Date.now() - started;
    latency = Math.max(0, Math.round(latency));
  }
  return { up, latency, reason: up ? null : 'timeout' };
}

let gatewayCache = { value: null, at: 0 };

async function getIpConfig() {
  const res = await execFileP('ipconfig', [], { timeout: 6000 });
  const text = res.stdout || '';
  const lines = text.split(/\r?\n/);

  const findIpv4 = (labelRegex) => {
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (!labelRegex.test(line)) continue;
      const inline = line.match(IPV4_RE);
      if (inline && !inline[1].startsWith('255.')) return inline[1];
      for (let j = i + 1; j <= Math.min(i + 2, lines.length - 1); j += 1) {
        if (!lines[j].trim()) continue;
        const next = lines[j].match(IPV4_RE);
        if (next && !next[1].startsWith('255.')) return next[1];
        if (/\w/.test(lines[j])) break;
      }
    }
    return null;
  };

  let gateway = findIpv4(/(?:Default Gateway|Gerbang Default|Standardgateway)/i);
  let localIp = findIpv4(/(?:IPv4 Address|Alamat IPv4|IPv4-Adresse)/i);

  // Fallback: read the IPv4 default route (works when ipconfig only shows IPv6).
  if (!gateway) {
    const route = await execFileP('route', ['print', '0.0.0.0'], { timeout: 5000 });
    for (const line of (route.stdout || '').split(/\r?\n/)) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 3 && parts[0] === '0.0.0.0' && parts[1] === '0.0.0.0' && IPV4_RE.test(parts[2])) {
        gateway = parts[2];
        break;
      }
    }
  }
  if (!localIp) {
    const route = await execFileP('route', ['print', '0.0.0.0'], { timeout: 5000 });
    for (const line of (route.stdout || '').split(/\r?\n/)) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 4 && parts[0] === '0.0.0.0' && parts[1] === '0.0.0.0' && IPV4_RE.test(parts[3])) {
        localIp = parts[3];
        break;
      }
    }
  }
  return { gateway, localIp };
}

async function getDefaultGateway(force = false) {
  if (!force && gatewayCache.value && Date.now() - gatewayCache.at < 30000) {
    return gatewayCache.value;
  }
  const cfg = await getIpConfig();
  gatewayCache = { value: cfg, at: Date.now() };
  return cfg;
}

let counterState = { rx: 0, tx: 0, at: 0 };

/**
 * Reads total NIC byte counters (all interfaces) via `netstat -e`.
 * Returns Mbps since the previous call. First call returns null rates.
 */
async function getNicThroughput() {
  const res = await execFileP('netstat', ['-e'], { timeout: 5000 });
  const match = (res.stdout || '').match(/Bytes\s+(\d+)\s+(\d+)/i);
  if (!match) return { rxMbps: null, txMbps: null, rxBytes: null, txBytes: null };
  const rx = Number(match[1]);
  const tx = Number(match[2]);
  const now = Date.now();
  let rxMbps = null;
  let txMbps = null;
  if (counterState.at && now > counterState.at) {
    const seconds = (now - counterState.at) / 1000;
    const dRx = Math.max(0, rx - counterState.rx);
    const dTx = Math.max(0, tx - counterState.tx);
    rxMbps = (dRx * 8) / seconds / 1e6;
    txMbps = (dTx * 8) / seconds / 1e6;
  }
  counterState = { rx, tx, at: now };
  return { rxMbps, txMbps, rxBytes: rx, txBytes: tx };
}

function parseArp(text) {
  const entries = [];
  let iface = null;
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    const ifaceMatch = line.match(/^Interface:\s*([0-9.]+)/i);
    if (ifaceMatch) {
      iface = ifaceMatch[1];
      continue;
    }
    const match = line.match(/^(\d{1,3}(?:\.\d{1,3}){3})\s+([0-9a-f]{2}(?:-[0-9a-f]{2}){5})\s+(\w+)/i);
    if (match) {
      entries.push({
        ip: match[1],
        mac: match[2].toLowerCase().replace(/-/g, ':'),
        type: match[3],
        iface,
      });
    }
  }
  return entries;
}

async function listArp() {
  const res = await execFileP('arp', ['-a'], { timeout: 6000 });
  return parseArp(res.stdout);
}

function isUnicastMac(mac) {
  if (!mac) return false;
  const first = parseInt(mac.slice(0, 2), 16);
  if (Number.isNaN(first)) return false;
  if (first & 0x01) return false; // multicast/broadcast
  return mac !== 'ff:ff:ff:ff:ff:ff';
}

const OUI = {
  '3c:22:fb': 'Apple', 'a4:83:e7': 'Apple', 'f0:18:98': 'Apple', '8c:85:90': 'Apple',
  '00:1b:63': 'Apple', '28:cf:e9': 'Apple', '60:03:08': 'Apple', '00:1c:b3': 'Apple',
  '8c:77:12': 'Samsung', '34:23:ba': 'Samsung', '5c:0a:5b': 'Samsung', 'e8:50:8b': 'Samsung',
  '64:cc:2e': 'Xiaomi', '78:11:dc': 'Xiaomi', '50:8f:4c': 'Xiaomi', '28:6c:07': 'Xiaomi',
  '00:e0:fc': 'Huawei', '48:46:fb': 'Huawei', '70:72:3c': 'Huawei', 'ac:e2:15': 'Huawei',
  '50:c7:bf': 'TP-Link', 'a4:2b:b0': 'TP-Link', '60:32:b1': 'TP-Link', 'b0:be:76': 'TP-Link',
  '00:1a:a1': 'Cisco', '00:26:0b': 'Cisco', '2c:ab:00': 'Cisco', '00:0b:86': 'Aruba',
  '4c:5e:0c': 'MikroTik', '6c:3b:6b': 'MikroTik', '48:8f:5a': 'MikroTik', '18:fd:74': 'MikroTik',
  '3c:58:c2': 'Intel', '8c:16:45': 'Intel', '34:13:e8': 'Intel',
  '00:e0:4c': 'Realtek', '24:0a:c4': 'Espressif', '30:ae:a4': 'Espressif', '84:f3:eb': 'Espressif',
  '7c:9e:bd': 'Espressif', 'b8:27:eb': 'Raspberry Pi', 'dc:a6:32': 'Raspberry Pi',
  'e4:5f:01': 'Raspberry Pi', '00:0c:29': 'VMware', '00:50:56': 'VMware', '08:00:27': 'VirtualBox',
  '00:15:5d': 'Microsoft', '3c:5a:b4': 'Google', 'f4:f5:d8': 'Google', '44:65:0d': 'Amazon',
  '68:54:fd': 'Amazon', 'fc:65:de': 'Amazon', '00:11:32': 'Synology', '24:a4:3c': 'Ubiquiti',
  '78:8a:20': 'Ubiquiti', 'f0:9f:c2': 'Ubiquiti', '58:a2:b5': 'LG', 'c4:36:6c': 'LG',
  '00:13:a9': 'Sony', 'fc:0f:e6': 'Sony', '98:b6:e9': 'Nintendo', '58:bd:a3': 'Nintendo',
  '44:19:b6': 'Hikvision', 'c0:56:e3': 'Hikvision', 'bc:ad:28': 'Hikvision',
  '3c:ef:8c': 'Dahua', '90:02:a9': 'Dahua', 'e0:50:8b': 'Dahua',
  '18:69:d8': 'Tuya', '84:cc:a8': 'Shelly', '00:17:88': 'Philips Hue',
  '3c:d9:2b': 'HP', '9c:b6:54': 'HP', '00:14:22': 'Dell', 'b0:83:fe': 'Dell',
  '00:59:07': 'Lenovo', '54:e1:ad': 'Lenovo', '04:d4:c4': 'ASUS', '2c:56:dc': 'ASUS',
  'c8:3a:35': 'Tenda', '50:2b:73': 'Tenda', '34:e0:cf': 'ZTE', '9c:a5:25': 'ZTE',
  '00:09:0f': 'Fortinet', '70:4c:a5': 'Fortinet', '00:05:85': 'Juniper',
};

function macVendor(mac) {
  if (!mac) return 'Tidak diketahui';
  const clean = mac.toLowerCase().replace(/-/g, ':');
  const first = parseInt(clean.slice(0, 2), 16);
  if (!Number.isNaN(first) && first & 0x02) return 'MAC privat';
  return OUI[clean.slice(0, 8)] || 'Tidak diketahui';
}

/**
 * Full /24 ping sweep (max 254 hosts, bounded concurrency) followed by a
 * fresh ARP read. Used only when the user explicitly asks to scan clients.
 */
async function pingSweep(base, { concurrency = 48, timeoutMs = 250, onProgress } = {}) {
  const hosts = [];
  for (let i = 1; i <= 254; i += 1) hosts.push(`${base}.${i}`);
  let index = 0;
  let done = 0;
  const alive = [];
  const worker = async () => {
    while (index < hosts.length) {
      const host = hosts[index];
      index += 1;
      const result = await ping(host, timeoutMs);
      if (result.up) alive.push(host);
      done += 1;
      if (onProgress && done % 32 === 0) onProgress(done, hosts.length);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  return { scanned: done, alive };
}

async function pingAll(hosts, timeoutMs = 900, concurrency = 12) {
  const results = new Map();
  let index = 0;
  const worker = async () => {
    while (index < hosts.length) {
      const host = hosts[index];
      index += 1;
      results.set(host, await ping(host, timeoutMs));
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, hosts.length) }, worker));
  return results;
}

module.exports = {
  ping,
  pingAll,
  pingSweep,
  getIpConfig,
  getDefaultGateway,
  getNicThroughput,
  listArp,
  parseArp,
  isUnicastMac,
  macVendor,
  IPV4_RE,
};

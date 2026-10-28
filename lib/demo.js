'use strict';

const { rand, randInt, pick, uid } = require('./util');

const CATEGORY_RULES = [
  ['Streaming', /youtube|youtu\.be|googlevideo|netflix|spotify|vidio|disney|primevideo|twitch|tiktokcdn/i],
  ['Sosial', /instagram|facebook|whatsapp|twitter|x\.com|telegram|snapchat|line\.me|threads/i],
  ['Belanja', /tokopedia|shopee|lazada|bukalapak|blibli|amazon|aliexpress|tiktok\.com/i],
  ['Kerja', /github|gitlab|slack|zoom|notion|google|microsoft|office|cloudflare|npmjs|jira|atlassian|drive/i],
  ['Game', /steam|epicgames|riot|roblox|mobilelegends|garena|playstation|xbox|battle\.net/i],
  ['Sistem', /windowsupdate|apple\.com|msftconnecttest|dns\.msft|ntp|ubuntu|debian|archlinux/i],
];

function categorize(domain) {
  const value = String(domain || '').toLowerCase();
  for (const [name, regex] of CATEGORY_RULES) {
    if (regex.test(value)) return name;
  }
  return 'Lainnya';
}

const DEMO_DEVICES = [
  { id: 'core', name: 'Core Router', host: '192.168.1.1', type: 'router', location: 'Ruang Server', baseLatency: 3, down: 46, up: 18, jitter: 1.5 },
  { id: 'dist', name: 'Distribution Switch', host: '192.168.1.2', type: 'switch', location: 'Rak Lantai 1', baseLatency: 4, down: 22, up: 9, jitter: 2 },
  { id: 'ap2', name: 'Access Point Lt.2', host: '192.168.1.11', type: 'ap', location: 'Lantai 2 - Koridor', baseLatency: 9, down: 54, up: 15, jitter: 5 },
  { id: 'apmeet', name: 'AP Meeting Room', host: '192.168.1.12', type: 'ap', location: 'Lantai 3 - Meeting', baseLatency: 38, down: 19, up: 6, jitter: 14 },
  { id: 'srv', name: 'Server Monitoring', host: '192.168.1.20', type: 'server', location: 'Ruang Server', baseLatency: 2, down: 13, up: 7, jitter: 1 },
  { id: 'nas', name: 'NAS Backup', host: '192.168.1.21', type: 'server', location: 'Ruang Server', baseLatency: 3, down: 8, up: 23, jitter: 1.5 },
  { id: 'prn', name: 'Printer Finance', host: '192.168.1.31', type: 'printer', location: 'Lantai 2 - Finance', baseLatency: 12, down: 0.2, up: 0.1, jitter: 4 },
  { id: 'cctv', name: 'CCTV Gate', host: '192.168.1.41', type: 'cctv', location: 'Gerbang Depan', baseLatency: 7, down: 6.2, up: 4.1, jitter: 2 },
  { id: 'voip', name: 'VoIP Receptionist', host: '192.168.1.51', type: 'voip', location: 'Lobby', baseLatency: 14, down: 0.4, up: 0.4, jitter: 6 },
  { id: 'swg', name: 'Switch Gudang', host: '192.168.1.3', type: 'switch', location: 'Gudang Belakang', baseLatency: 6, down: 3.1, up: 1.2, jitter: 2 },
  { id: 'tv', name: 'Smart TV Lobby', host: '192.168.1.61', type: 'iot', location: 'Lobby', baseLatency: 23, down: 9.5, up: 1.1, jitter: 8 },
  { id: 'cam2', name: 'CCTV Parkir', host: '192.168.1.42', type: 'cctv', location: 'Area Parkir', baseLatency: 11, down: 6.4, up: 4.2, jitter: 3 },
];

function initDemoDevices() {
  return DEMO_DEVICES.map((device) => ({
    ...device,
    status: 'up',
    latency: device.baseLatency + rand(-1, 3),
    loss: 0,
    downMbps: device.down * rand(0.7, 1.15),
    upMbps: device.up * rand(0.7, 1.15),
    lastCheck: Date.now(),
    downUntil: 0,
    lastOutageAt: 0,
    spikeUntil: 0,
    history: [],
    upSamples: 1,
    totalSamples: 1,
    downtimeMs: 0,
  }));
}

function stepDemo(devices, thresholds = {}) {
  const now = Date.now();
  const latencyLimit = Number(thresholds.latencyMs) || 120;

  // One device goes down roughly every ~2 minutes, for 12-24 seconds.
  if (!devices.some((d) => d.downUntil > now) && Math.random() < 0.012) {
    const candidates = devices.filter((d) => now - d.lastOutageAt > 45000);
    if (candidates.length) {
      const victim = pick(candidates);
      victim.downUntil = now + randInt(6, 12) * 2000;
      victim.lastOutageAt = now;
    }
  }

  for (const device of devices) {
    device.lastCheck = now;
    device.totalSamples += 1;

    if (device.downUntil > now) {
      device.status = 'down';
      device.latency = null;
      device.loss = 100;
      device.downMbps = 0;
      device.upMbps = 0;
      device.downtimeMs += 2000;
      continue;
    }

    if (device.status === 'down') {
      device.downUntil = 0;
    }

    if (now > device.spikeUntil && Math.random() < 0.018) {
      device.spikeUntil = now + randInt(2, 4) * 2000;
    }
    const spiking = device.spikeUntil > now;
    const spikeFactor = spiking ? rand(1.8, 3.4) : 1;
    const latency = Math.max(1, device.baseLatency * spikeFactor + rand(-device.jitter, device.jitter * 1.6));
    device.latency = Math.round(latency * 10) / 10;
    device.loss = spiking ? Math.round(rand(0.5, 3.2) * 10) / 10 : Math.random() < 0.06 ? 0.1 : 0;
    device.status = device.latency > latencyLimit ? 'warning' : 'up';
    device.upSamples += 1;

    const noise = rand(0.72, 1.28);
    device.downMbps = Math.max(0, device.down * noise);
    device.upMbps = Math.max(0, device.up * rand(0.7, 1.3));
  }

  return devices;
}

const DEMO_CURRENT = {
  ssid: 'NetWatch-HQ',
  bssid: 'a4:2b:b0:1c:8e:20',
  band: '5 GHz',
  channel: 44,
  signal: 92,
  rssi: -41,
  rxMbps: 866,
  txMbps: 780,
  auth: 'WPA3-Personal',
  cipher: 'CCMP',
  radio: '802.11ax',
  mac: '60:45:2e:3b:d5:4e',
  connected: true,
  state: 'connected',
  name: 'Wi-Fi',
  stations: 12,
  utilization: 18,
};

const DEMO_NEARBY = [
  { ssid: 'NetWatch-HQ', bssid: 'a4:2b:b0:1c:8e:20', signal: 92, channel: 44, band: '5 GHz', radio: '802.11ax', stations: 12, utilization: 18, auth: 'WPA3-Personal', cipher: 'CCMP', security: 'WPA3' },
  { ssid: 'NetWatch-Guest', bssid: 'a4:2b:b0:1c:8e:21', signal: 74, channel: 6, band: '2.4 GHz', radio: '802.11n', stations: 8, utilization: 34, auth: 'WPA2-Personal', cipher: 'CCMP', security: 'WPA2' },
  { ssid: 'IndiHome-2G', bssid: '50:c7:bf:44:91:02', signal: 61, channel: 6, band: '2.4 GHz', radio: '802.11n', stations: 4, utilization: 41, auth: 'WPA2-Personal', cipher: 'CCMP', security: 'WPA2' },
  { ssid: 'MyRepublic-5G', bssid: '8c:16:45:2a:7c:10', signal: 48, channel: 149, band: '5 GHz', radio: '802.11ac', stations: 6, utilization: 12, auth: 'WPA2-Personal', cipher: 'CCMP', security: 'WPA2' },
  { ssid: 'Kos-Putri-03', bssid: 'c8:3a:35:9e:11:aa', signal: 34, channel: 11, band: '2.4 GHz', radio: '802.11n', stations: 3, utilization: 27, auth: 'WPA2-Personal', cipher: 'CCMP', security: 'WPA2' },
  { ssid: 'FreeWiFi-Mall', bssid: '00:e0:4c:77:31:bd', signal: 27, channel: 1, band: '2.4 GHz', radio: '802.11n', stations: 5, utilization: 68, auth: 'Open', cipher: 'None', security: 'Terbuka' },
  { ssid: 'TP-Link_8A2C', bssid: '50:2b:73:8a:2c:01', signal: 22, channel: 9, band: '2.4 GHz', radio: '802.11n', stations: 1, utilization: 15, auth: 'WPA2-Personal', cipher: 'CCMP', security: 'WPA2' },
  { ssid: 'CCTV-Office', bssid: 'bc:ad:28:11:03:fe', signal: 18, channel: 13, band: '2.4 GHz', radio: '802.11n', stations: 2, utilization: 52, auth: 'WPA2-Personal', cipher: 'CCMP', security: 'WPA2' },
];

const DEMO_CLIENTS = [
  { ip: '192.168.1.1', mac: 'a4:2b:b0:1c:8e:01', vendor: 'TP-Link', name: 'Gateway', role: 'gateway', status: 'online' },
  { ip: '192.168.1.20', mac: '00:14:22:aa:10:20', vendor: 'Dell', name: 'Server Monitoring', role: 'client', status: 'online' },
  { ip: '192.168.1.101', mac: '3c:58:c2:1a:2b:01', vendor: 'Intel', name: 'Laptop-NOC', role: 'client', status: 'online' },
  { ip: '192.168.1.102', mac: 'f0:18:98:3c:44:02', vendor: 'Apple', name: 'iPhone-Rina', role: 'client', status: 'online' },
  { ip: '192.168.1.103', mac: '8c:77:12:9d:11:03', vendor: 'Samsung', name: 'Galaxy-A54', role: 'client', status: 'online' },
  { ip: '192.168.1.104', mac: 'a4:83:e7:52:aa:04', vendor: 'Apple', name: 'MacBook-Design', role: 'client', status: 'online' },
  { ip: '192.168.1.105', mac: '64:cc:2e:71:bb:05', vendor: 'Xiaomi', name: 'Redmi-Note-13', role: 'client', status: 'online' },
  { ip: '192.168.1.106', mac: '58:a2:b5:22:cc:06', vendor: 'LG', name: 'Smart-TV-Lobby', role: 'client', status: 'online' },
  { ip: '192.168.1.107', mac: '3c:d9:2b:11:dd:07', vendor: 'HP', name: 'Printer-Finance', role: 'client', status: 'idle' },
  { ip: '192.168.1.108', mac: '44:19:b6:33:ee:08', vendor: 'Hikvision', name: 'CCTV-Gate', role: 'client', status: 'online' },
  { ip: '192.168.1.109', mac: '3c:5a:b4:44:ff:09', vendor: 'Google', name: 'Pixel-6', role: 'client', status: 'online' },
  { ip: '192.168.1.110', mac: '24:0a:c4:55:aa:0a', vendor: 'Espressif', name: 'Sensor-Suhu', role: 'client', status: 'online' },
];

const DEMO_ACTIVITY_DOMAINS = [
  'youtube.com', 'googlevideo.com', 'instagram.com', 'facebook.com', 'whatsapp.net',
  'tiktok.com', 'github.com', 'zoom.us', 'tokopedia.com', 'shopee.co.id',
  'steamcommunity.com', 'google.com', 'cloudflare.com', 'netflix.com', 'spotify.com',
  'mobilelegends.com', 'office.com', 'slack.com', 'apple.com', 'windowsupdate.com',
];

function demoTickActivity(clients, count = 2) {
  const entries = [];
  for (let i = 0; i < count; i += 1) {
    const client = pick(clients);
    const domain = pick(DEMO_ACTIVITY_DOMAINS);
    entries.push({
      id: uid('dns'),
      t: Date.now() - randInt(0, 900),
      clientIp: client.ip,
      clientName: client.name,
      domain,
      category: categorize(domain),
      qtype: 'A',
      demo: true,
    });
  }
  return entries;
}

module.exports = {
  DEMO_DEVICES,
  DEMO_CURRENT,
  DEMO_NEARBY,
  DEMO_CLIENTS,
  DEMO_ACTIVITY_DOMAINS,
  initDemoDevices,
  stepDemo,
  demoTickActivity,
  categorize,
};

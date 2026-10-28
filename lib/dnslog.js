'use strict';

const dgram = require('dgram');
const nodeDns = require('dns');
const { uid } = require('./util');
const { categorize } = require('./demo');

const QTYPE = {
  1: 'A', 2: 'NS', 5: 'CNAME', 6: 'SOA', 12: 'PTR', 15: 'MX', 16: 'TXT',
  28: 'AAAA', 33: 'SRV', 35: 'NAPTR', 43: 'DS', 46: 'RRSIG', 64: 'SVCB', 65: 'HTTPS',
};

function parseQuestion(buffer) {
  if (!buffer || buffer.length < 13) return null;
  let offset = 12;
  const labels = [];
  let guard = 0;
  while (offset < buffer.length && guard < 64) {
    guard += 1;
    const length = buffer[offset];
    if (length === 0) {
      offset += 1;
      break;
    }
    if (length > 63) return null;
    const label = buffer.toString('utf8', offset + 1, offset + 1 + length);
    labels.push(label);
    offset += length + 1;
  }
  if (!labels.length) return null;
  const qtype = buffer.length >= offset + 2 ? buffer.readUInt16BE(offset) : 1;
  return { name: labels.join('.'), qtype: QTYPE[qtype] || String(qtype) };
}

class DnsLogger {
  constructor(getConfig, onEntry) {
    this.getConfig = getConfig;
    this.onEntry = onEntry || (() => {});
    this.socket = null;
    this.running = false;
    this.error = null;
    this.startedAt = null;
    this.entries = [];
    this.total = 0;
    this.byDomain = new Map();
    this.byClient = new Map();
    this.lastQueryAt = null;
  }

  async start() {
    if (this.running) return { ok: true };
    const config = this.getConfig().dns || {};
    const port = Number(config.port) || 5354;
    const upstream = config.upstream || '8.8.8.8';
    this.upstream = upstream;
    this.port = port;

    return new Promise((resolve) => {
      const socket = dgram.createSocket('udp4');
      this.socket = socket;
      const onError = (err) => {
        this.error = err.message;
        this.running = false;
        try { socket.close(); } catch (_) {}
        this.socket = null;
        resolve({ ok: false, error: err.message });
      };
      socket.once('error', onError);
      socket.bind(port, '0.0.0.0', () => {
        socket.removeListener('error', onError);
        socket.on('error', (err) => { this.error = err.message; });
        socket.on('message', (msg, rinfo) => this.handle(msg, rinfo));
        this.running = true;
        this.error = null;
        this.startedAt = Date.now();
        resolve({ ok: true, port, upstream });
      });
    });
  }

  stop() {
    if (this.socket) {
      try { this.socket.close(); } catch (_) {}
    }
    this.socket = null;
    this.running = false;
    this.startedAt = null;
    return { ok: true };
  }

  handle(msg, rinfo) {
    const question = parseQuestion(msg);
    if (!question) return;
    const domain = question.name.replace(/\.$/, '').toLowerCase();
    this.total += 1;
    this.lastQueryAt = Date.now();
    this.byDomain.set(domain, (this.byDomain.get(domain) || 0) + 1);
    this.byClient.set(rinfo.address, (this.byClient.get(rinfo.address) || 0) + 1);

    const entry = {
      id: uid('dns'),
      t: Date.now(),
      clientIp: rinfo.address,
      domain,
      category: categorize(domain),
      qtype: question.qtype,
      demo: false,
    };
    this.entries.unshift(entry);
    if (this.entries.length > 300) this.entries.length = 300;
    this.onEntry(entry);
    this.forward(msg, rinfo);
  }

  forward(msg, rinfo) {
    const configured = this.upstream || '8.8.8.8';
    const servers = [configured, ...nodeDns.getServers(), '8.8.8.8', '1.1.1.1']
      .filter((ip) => typeof ip === 'string' && /^[0-9.]+$/.test(ip));
    const upstreams = Array.from(new Set(servers)).slice(0, 4);

    const attempt = (index) => {
      if (index >= upstreams.length) {
        // Semua upstream gagal: kirim SERVFAIL agar klien tidak menggantung.
        try {
          const reply = Buffer.from(msg);
          if (reply.length >= 12) {
            reply[2] = (reply[2] & 0x01) | 0x80; // QR = response
            reply[3] = (reply[3] & 0xf0) | 0x02; // RCODE = SERVFAIL
            reply.writeUInt16BE(0, 6);
            reply.writeUInt16BE(0, 8);
            reply.writeUInt16BE(0, 10);
            this.socket.send(reply, rinfo.port, rinfo.address);
          }
        } catch (_) {}
        return;
      }

      const socket = dgram.createSocket('udp4');
      let done = false;
      let timer = null;
      const finish = (ok) => {
        if (done) return;
        done = true;
        if (timer) clearTimeout(timer);
        try { socket.close(); } catch (_) {}
        if (!ok) attempt(index + 1);
      };
      timer = setTimeout(() => finish(false), 1800);
      socket.on('message', (response) => {
        try { this.socket.send(response, rinfo.port, rinfo.address); } catch (_) {}
        finish(true);
      });
      socket.on('error', () => finish(false));
      try {
        socket.send(msg, 53, upstreams[index], (err) => { if (err) finish(false); });
      } catch (_) {
        finish(false);
      }
    };

    attempt(0);
  }

  stats() {
    const topDomains = Array.from(this.byDomain.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([domain, count]) => ({ domain, count, category: categorize(domain) }));
    const topClients = Array.from(this.byClient.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([ip, count]) => ({ ip, count }));
    return {
      total: this.total,
      uniqueDomains: this.byDomain.size,
      uniqueClients: this.byClient.size,
      topDomains,
      topClients,
    };
  }

  snapshot() {
    return {
      enabled: this.running,
      running: this.running,
      port: this.port || (this.getConfig().dns || {}).port || 5354,
      upstream: this.upstream || (this.getConfig().dns || {}).upstream || '8.8.8.8',
      startedAt: this.startedAt,
      error: this.error,
      lastQueryAt: this.lastQueryAt,
      entries: this.entries.slice(0, 100),
      stats: this.stats(),
    };
  }
}

module.exports = { DnsLogger, parseQuestion, QTYPE };

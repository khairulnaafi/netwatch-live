'use strict';

/**
 * Klien DNS kecil untuk menguji DNS logger NetWatch Live.
 * Contoh:
 *   node tools/dns-query.js example.com
 *   node tools/dns-query.js openai.com 5354 127.0.0.1
 */

const dgram = require('dgram');

const name = process.argv[2] || 'example.com';
const port = Number(process.argv[3]) || 5354;
const server = process.argv[4] || '127.0.0.1';

const labels = name.replace(/\.$/, '').split('.').map((label) => {
  const buf = Buffer.from(label, 'utf8');
  return Buffer.concat([Buffer.from([buf.length]), buf]);
});

const query = Buffer.concat([
  Buffer.from([0x12, 0x34, 0x01, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]),
  ...labels,
  Buffer.from([0x00, 0x00, 0x01, 0x00, 0x01]),
]);

const socket = dgram.createSocket('udp4');
let settled = false;

function done(message, code = 0) {
  if (settled) return;
  settled = true;
  console.log(message);
  try { socket.close(); } catch (_) {}
  process.exit(code);
}

socket.on('message', (reply) => {
  const rcode = reply[3] & 0x0f;
  const answers = reply.readUInt16BE(6);
  done(`Balasan dari ${server}:${port} — ${reply.length} byte, rcode=${rcode}, jawaban=${answers}`);
});

socket.on('error', (err) => done(`Gagal: ${err.message}`, 1));

socket.send(query, port, server, (err) => {
  if (err) done(`Gagal mengirim: ${err.message}`, 1);
  else console.log(`Mengirim query "${name}" ke ${server}:${port} ...`);
});

setTimeout(() => done('Tidak ada balasan (timeout 5 detik). Apakah DNS logger aktif?', 1), 5000);

'use strict';

/**
 * Cetak token link admin (sha256 dari "user:pass", 32 karakter pertama).
 * Dipakai start-live.bat supaya dashboard terbuka tanpa mengetik password.
 * Tidak mencetak apa pun bila kredensial belum diisi.
 */

const crypto = require('crypto');

const user = process.env.NETWATCH_USER || '';
const pass = process.env.NETWATCH_PASS || '';

if (!user || !pass) process.exit(0);

process.stdout.write(
  crypto.createHash('sha256').update(`${user}:${pass}`).digest('hex').slice(0, 32)
);

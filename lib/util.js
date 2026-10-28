'use strict';

const { execFile } = require('child_process');

/**
 * Promise wrapper for execFile. Never rejects: returns { ok, stdout, stderr }.
 * Commands are always passed as an argument array (no shell interpolation).
 */
function execFileP(file, args = [], opts = {}) {
  const { timeout = 8000, ...rest } = opts;
  return new Promise((resolve) => {
    execFile(
      file,
      args,
      { timeout, windowsHide: true, maxBuffer: 8 * 1024 * 1024, ...rest },
      (err, stdout, stderr) => {
        resolve({
          ok: !err,
          code: err && typeof err.code === 'number' ? err.code : err ? 1 : 0,
          stdout: stdout || '',
          stderr: stderr || '',
        });
      }
    );
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
const round = (v, digits = 1) => {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
};
const rand = (min, max) => min + Math.random() * (max - min);
const randInt = (min, max) => Math.floor(rand(min, max + 1));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

let seq = 0;
function uid(prefix = 'id') {
  seq = (seq + 1) % 1e6;
  return `${prefix}_${Date.now().toString(36)}_${seq.toString(36)}`;
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatMbps(v) {
  if (v == null || Number.isNaN(v)) return '-';
  if (v >= 1000) return `${round(v / 1000, 2)} Gbps`;
  if (v >= 100) return `${round(v, 0)} Mbps`;
  if (v >= 10) return `${round(v, 1)} Mbps`;
  return `${round(v, 2)} Mbps`;
}

function formatMs(v) {
  if (v == null || Number.isNaN(v)) return '-';
  return `${round(v, v < 10 ? 1 : 0)} ms`;
}

function timestamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function dateTimeId(ts = Date.now()) {
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

module.exports = {
  execFileP,
  sleep,
  clamp,
  round,
  rand,
  randInt,
  pick,
  uid,
  escapeHtml,
  formatMbps,
  formatMs,
  timestamp,
  dateTimeId,
};

'use strict';

const { uid, escapeHtml, dateTimeId } = require('./util');

function plainText(text) {
  return String(text || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .trim();
}

class Notifier {
  constructor(getConfig) {
    this.getConfig = getConfig;
    this.log = [];
  }

  record(entry) {
    const item = { id: uid('ntf'), t: Date.now(), ...entry };
    this.log.unshift(item);
    if (this.log.length > 100) this.log.length = 100;
    return item;
  }

  telegramReady() {
    const cfg = this.getConfig().telegram || {};
    return Boolean(cfg.enabled && cfg.botToken && cfg.chatId);
  }

  whatsappReady() {
    const cfg = this.getConfig().whatsapp || {};
    return Boolean(cfg.enabled && cfg.provider && cfg.token && cfg.target);
  }

  async sendTelegram(text) {
    const cfg = this.getConfig().telegram || {};
    if (!this.telegramReady()) {
      return { ok: false, skipped: true, error: 'Telegram belum aktif atau belum dikonfigurasi.' };
    }
    try {
      const res = await fetch(`https://api.telegram.org/bot${cfg.botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: cfg.chatId,
          text,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        }),
        signal: AbortSignal.timeout(9000),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) {
        return { ok: false, error: data.description || `HTTP ${res.status}` };
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.name === 'TimeoutError' ? 'Timeout ke Telegram' : err.message };
    }
  }

  async sendWhatsApp(text) {
    const cfg = this.getConfig().whatsapp || {};
    if (!this.whatsappReady()) {
      return { ok: false, skipped: true, error: 'WhatsApp belum aktif atau belum dikonfigurasi.' };
    }
    const provider = cfg.provider || 'generic';
    try {
      let url = cfg.url;
      let options = { method: 'POST', signal: AbortSignal.timeout(9000) };
      if (provider === 'fonnte') {
        url = url || 'https://api.fonnte.com/send';
        options.headers = { Authorization: cfg.token };
        options.body = new URLSearchParams({ target: cfg.target, message: text });
      } else if (provider === 'wablas') {
        url = url || 'https://pati.wablas.com/api/send-message';
        options.headers = { Authorization: cfg.token };
        options.body = new URLSearchParams({ phone: cfg.target, message: text });
      } else if (provider === 'meta') {
        if (!cfg.phoneNumberId) return { ok: false, error: 'phoneNumberId Meta belum diisi.' };
        url = `https://graph.facebook.com/v20.0/${cfg.phoneNumberId}/messages`;
        options.headers = { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' };
        options.body = JSON.stringify({
          messaging_product: 'whatsapp',
          to: cfg.target,
          type: 'text',
          text: { body: text },
        });
      } else {
        if (!url) return { ok: false, error: 'URL webhook WhatsApp belum diisi.' };
        options.headers = { 'Content-Type': 'application/json' };
        if (cfg.token) options.headers.Authorization = `Bearer ${cfg.token}`;
        options.body = JSON.stringify({ target: cfg.target, message: text });
      }
      if (!url) return { ok: false, error: 'URL endpoint WhatsApp belum diisi.' };
      const res = await fetch(url, options);
      const raw = await res.text().catch(() => '');
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}: ${raw.slice(0, 160)}` };
      return { ok: true, detail: raw.slice(0, 160) };
    } catch (err) {
      return { ok: false, error: err.name === 'TimeoutError' ? 'Timeout ke endpoint WhatsApp' : err.message };
    }
  }

  async sendEvent({ title, message, level = 'info', device = null }) {
    const emoji = level === 'critical' ? '\u{1F534}' : level === 'warning' ? '\u{1F7E0}' : level === 'success' ? '\u{1F7E2}' : '\u{2139}\u{FE0F}';
    const html = [
      `${emoji} <b>${escapeHtml(title)}</b>`,
      device ? `<b>${escapeHtml(device.name)}</b> (${escapeHtml(device.host || '-')})` : null,
      message ? escapeHtml(message) : null,
      `<i>${dateTimeId()}</i>`,
    ]
      .filter(Boolean)
      .join('\n');
    const text = plainText(html);
    const results = [];
    if (this.telegramReady()) {
      const res = await this.sendTelegram(html);
      results.push({ channel: 'Telegram', ...res });
      this.record({ channel: 'Telegram', ok: res.ok, title, message: text, error: res.error || null });
    }
    if (this.whatsappReady()) {
      const res = await this.sendWhatsApp(text);
      results.push({ channel: 'WhatsApp', ...res });
      this.record({ channel: 'WhatsApp', ok: res.ok, title, message: text, error: res.error || null });
    }
    return results;
  }

  async test(channel) {
    const title = 'Tes notifikasi NetWatch Live';
    const message = `Koneksi notifikasi berhasil. Dashboard aktif pada ${dateTimeId()}.`;
    if (channel === 'telegram') {
      const html = `\u{1F7E2} <b>${escapeHtml(title)}</b>\n${escapeHtml(message)}`;
      const res = await this.sendTelegram(html);
      this.record({ channel: 'Telegram', ok: res.ok, title: 'Tes koneksi', message, error: res.error || null });
      return res;
    }
    if (channel === 'whatsapp') {
      const res = await this.sendWhatsApp(`${title}\n${message}`);
      this.record({ channel: 'WhatsApp', ok: res.ok, title: 'Tes koneksi', message, error: res.error || null });
      return res;
    }
    return { ok: false, error: 'Channel tidak dikenal.' };
  }
}

module.exports = { Notifier, plainText };

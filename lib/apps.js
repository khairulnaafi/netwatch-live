'use strict';

/**
 * Perkiraan aplikasi dari nama domain.
 *
 * Ini BUKAN deteksi aplikasi sungguhan: yang terlihat di jaringan hanya nama
 * domain. Aplikasi besar memakai domain/CDN yang khas (YouTube selalu
 * googlevideo.com, TikTok selalu tiktokcdn.com), jadi tebakannya cukup akurat.
 * Domain umum seperti google.com atau cloudflare.com sengaja tidak dipetakan
 * karena dipakai banyak aplikasi sekaligus.
 */

const APP_RULES = [
  { app: 'YouTube', color: '#ff4d4d', match: ['youtube.com', 'youtu.be', 'googlevideo.com', 'ytimg.com', 'yt3.ggpht.com', 'youtube-nocookie.com'] },
  { app: 'TikTok', color: '#22d3ee', match: ['tiktok.com', 'tiktokcdn.com', 'tiktokv.com', 'byteoversea.com', 'ibytedtos.com', 'musical.ly'] },
  { app: 'Instagram', color: '#f472b6', match: ['instagram.com', 'cdninstagram.com'] },
  { app: 'Facebook', color: '#60a5fa', match: ['facebook.com', 'fbcdn.net', 'fb.com', 'fbsbx.com'] },
  { app: 'WhatsApp', color: '#34d399', match: ['whatsapp.net', 'whatsapp.com', 'wa.me'] },
  { app: 'Telegram', color: '#38bdf8', match: ['telegram.org', 't.me', 'telegram.me', 'telesco.pe'] },
  { app: 'Netflix', color: '#ef4444', match: ['netflix.com', 'nflxvideo.net', 'nflxso.net', 'nflximg.net'] },
  { app: 'Spotify', color: '#22c55e', match: ['spotify.com', 'scdn.co', 'spotifycdn.com'] },
  { app: 'Shopee', color: '#f97316', match: ['shopee.co.id', 'shopee.com', 'susercontent.com', 'shopeemobile.com'] },
  { app: 'Tokopedia', color: '#22c55e', match: ['tokopedia.com', 'tokopedia.net', 'tokolink.com'] },
  { app: 'Lazada', color: '#f43f5e', match: ['lazada.co.id', 'lazada.com', 'alicdn.com'] },
  { app: 'Gojek', color: '#10b981', match: ['gojek.com', 'go-jek.com', 'gojekapi.com'] },
  { app: 'Grab', color: '#16a34a', match: ['grab.com', 'grabtaxi.com'] },
  { app: 'X (Twitter)', color: '#94a3b8', match: ['twitter.com', 'x.com', 'twimg.com', 't.co'] },
  { app: 'Discord', color: '#818cf8', match: ['discord.com', 'discordapp.com', 'discord.gg'] },
  { app: 'Zoom', color: '#60a5fa', match: ['zoom.us', 'zoom.com'] },
  { app: 'Mobile Legends', color: '#f59e0b', match: ['moonton.com', 'mobilelegends.com'] },
  { app: 'Free Fire', color: '#fb923c', match: ['garena.com', 'freefiremobile.com', 'ff.garena.com'] },
  { app: 'PUBG Mobile', color: '#fbbf24', match: ['pubgmobile.com', 'tencent.com', 'igamecj.com'] },
  { app: 'CapCut', color: '#a3e635', match: ['capcut.com', 'capcutapi.com'] },
  { app: 'Snack Video', color: '#f472b6', match: ['snackvideo.com', 'kuaishou.com'] },
  { app: 'Vidio', color: '#ef4444', match: ['vidio.com', 'vidio.static6.com'] },
  { app: 'Viu', color: '#facc15', match: ['viu.com', 'viu.tv'] },
  { app: 'Disney+ Hotstar', color: '#38bdf8', match: ['hotstar.com', 'disneyplus.com', 'dssott.com'] },
  { app: 'Canva', color: '#22d3ee', match: ['canva.com', 'canva.cn'] },
  { app: 'Steam', color: '#94a3b8', match: ['steampowered.com', 'steamcommunity.com', 'steamcontent.com'] },
  { app: 'Roblox', color: '#f87171', match: ['roblox.com', 'rbxcdn.com'] },
  { app: 'GitHub', color: '#cbd5e1', match: ['github.com', 'githubusercontent.com', 'githubassets.com'] },
  { app: 'Microsoft', color: '#38bdf8', match: ['microsoft.com', 'office.com', 'live.com', 'msftconnecttest.com', 'windowsupdate.com'] },
  { app: 'Apple', color: '#cbd5e1', match: ['apple.com', 'icloud.com', 'mzstatic.com', 'cdn-apple.com'] },
  { app: 'Cloudflare', color: '#f59e0b', match: ['cloudflare.com', 'cloudflare-dns.com', 'cdnjs.cloudflare.com'] },
  { app: 'Google', color: '#60a5fa', match: ['google.com', 'gstatic.com', 'googleapis.com', 'google.co.id', 'ggpht.com'] },
];

const SORTED = APP_RULES.slice().sort((a, b) => {
  const la = Math.max(...a.match.map((m) => m.length));
  const lb = Math.max(...b.match.map((m) => m.length));
  return lb - la;
});

function appFor(domain) {
  if (!domain) return null;
  const host = String(domain).toLowerCase().replace(/\.$/, '');
  for (const rule of SORTED) {
    for (const suffix of rule.match) {
      if (host === suffix || host.endsWith(`.${suffix}`)) {
        return { name: rule.app, color: rule.color };
      }
    }
  }
  return null;
}

module.exports = { appFor, APP_RULES };

(function () {
  'use strict';

  var STORE = 'nw_join_v1';
  var state = { id: '', key: '', name: '' };
  var timer = null;

  function $(sel) {
    return document.querySelector(sel);
  }

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function origin() {
    return window.location.origin;
  }

  function safeName(text) {
    return String(text || '').replace(/["`$\\]/g, '').trim().slice(0, 40);
  }

  /* ------------------------------------------------------------------ */

  function detectTab() {
    var ua = navigator.userAgent || '';
    if (/Android/i.test(ua)) return 'android';
    if (/Windows/i.test(ua)) return 'windows';
    return 'unix';
  }

  function selectTab(name) {
    var tabs = document.querySelectorAll('#tabs .tab');
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].classList.toggle('active', tabs[i].getAttribute('data-tab') === name);
    }
    var panes = document.querySelectorAll('.pane');
    for (var j = 0; j < panes.length; j++) {
      panes[j].classList.toggle('active', panes[j].getAttribute('data-pane') === name);
    }
  }

  /* ------------------------------------------------------------------ */

  function buildCommands() {
    var base = origin();
    var name = safeName(state.name) || 'Perangkat';
    var quoted = '"' + name + '"';

    var android =
      'curl -sL ' + base + '/agent/setup.sh | bash -s -- ' + base + ' ' + state.key + ' ' + quoted;
    var unix =
      'curl -sL ' + base + '/agent/agent.sh -o agent.sh && bash agent.sh ' + base + ' ' + state.key + ' ' + quoted;
    var winCfg = base + '\n' + state.key + '\n' + name;

    $('#cmdAndroid').textContent = android;
    $('#cmdUnix').textContent = unix;
    $('#cfgWindows').textContent = winCfg;
  }

  /* ------------------------------------------------------------------ */

  function setDot(kind) {
    var dot = $('#statusDot');
    dot.className = 'dot ' + kind;
  }

  function bars(signal) {
    var value = Number(signal) || 0;
    var on = value >= 75 ? 4 : value >= 50 ? 3 : value >= 25 ? 2 : value > 0 ? 1 : 0;
    var out = '<span class="bars">';
    for (var i = 1; i <= 4; i++) {
      out += '<i class="' + (i <= on ? 'on' : '') + '" style="height:' + i * 3 + 'px"></i>';
    }
    return out + '</span>';
  }

  function securityBadge(security) {
    var text = security || 'Tidak diketahui';
    var cls = text === 'Terbuka' ? 'open' : text === 'WPA3' ? 'good' : '';
    return '<span class="badge ' + cls + '">' + esc(text) + '</span>';
  }

  function render(data) {
    var dot = $('#statusDot');
    var text = $('#statusText');
    var sub = $('#statusSub');
    var table = $('#resultTable');

    if (!data || !data.found) {
      setDot('wait');
      text.innerHTML = 'Menunggu data…<small id="statusMeta">Perangkat belum mengirim apa pun. Pastikan langkah 2 sudah selesai.</small>';
      sub.textContent = 'Menunggu data pertama dari perangkat Anda…';
      table.innerHTML = '';
      return;
    }

    if (!data.online) {
      setDot('wait');
      text.innerHTML =
        'Perangkat terakhir mengirim ' + esc(ago(data.updatedAt)) + '<small>Agent sepertinya berhenti. Jalankan lagi langkah 2.</small>';
    } else {
      setDot('ok');
      var current = data.current && data.current.ssid ? data.current.ssid : 'tidak terhubung ke Wi-Fi';
      text.innerHTML =
        'Terhubung — ' + esc(data.count) + ' jaringan terdeteksi<small>Terhubung ke: ' + esc(current) + ' · diperbarui ' + esc(ago(data.updatedAt)) + '</small>';
    }

    sub.textContent = 'Data dari perangkat: ' + (data.name || state.name || '-');

    if (!data.top || !data.top.length) {
      table.innerHTML = '<p class="sub" style="margin-top:14px">Belum ada jaringan yang terbaca. Cek izin lokasi / GPS.</p>';
      return;
    }

    var rows = data.top
      .map(function (n) {
        return (
          '<tr>' +
          '<td>' + esc(n.ssid) + '</td>' +
          '<td>' + bars(n.signal) + (n.signal == null ? '—' : esc(n.signal) + '%') + '</td>' +
          '<td class="mono">' + esc(n.band || '—') + ' / ' + esc(n.channel == null ? '—' : n.channel) + '</td>' +
          '<td>' + securityBadge(n.security) + '</td>' +
          '</tr>'
        );
      })
      .join('');

    table.innerHTML =
      '<table><thead><tr><th>Wi-Fi</th><th>Sinyal</th><th>Band / Channel</th><th>Keamanan</th></tr></thead><tbody>' +
      rows +
      '</tbody></table>' +
      (data.count > data.top.length
        ? '<p class="sub" style="margin-top:10px">Menampilkan ' + data.top.length + ' dari ' + esc(data.count) + ' jaringan terkuat.</p>'
        : '');
  }

  function ago(ts) {
    if (!ts) return '-';
    var diff = Math.max(0, Date.now() - ts);
    var sec = Math.round(diff / 1000);
    if (sec < 10) return 'baru saja';
    if (sec < 60) return sec + ' detik lalu';
    var min = Math.round(sec / 60);
    if (min < 60) return min + ' menit lalu';
    return Math.round(min / 60) + ' jam lalu';
  }

  /* ------------------------------------------------------------------ */

  function poll() {
    if (!state.id) return;
    fetch(
      '/api/agent/status?id=' + encodeURIComponent(state.id) + '&key=' + encodeURIComponent(state.key),
      { cache: 'no-store' }
    )
      .then(function (res) {
        if (res.status === 401 || res.status === 403) {
          throw { expired: true };
        }
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(render)
      .catch(function (e) {
        if (e && e.expired) {
          resetSession('Sesi perangkat ini sudah berakhir. Isi nama lagi untuk memulai ulang.');
          return;
        }
        setDot('wait');
        $('#statusText').innerHTML =
          'Tidak bisa menghubungi server<small>Coba muat ulang halaman ini.</small>';
      });
  }

  function resetSession(message) {
    if (timer) clearInterval(timer);
    timer = null;
    state = { id: '', key: '', name: '' };
    try {
      sessionStorage.removeItem(STORE);
    } catch (_) {}
    $('#stepInstall').classList.add('hidden');
    $('#stepStatus').classList.add('hidden');
    $('#stepName').classList.remove('hidden');
    var err = $('#nameErr');
    err.textContent = message || '';
    err.classList.toggle('hidden', !message);
  }

  function startPolling() {
    if (timer) clearInterval(timer);
    poll();
    timer = setInterval(poll, 5000);
  }

  /* ------------------------------------------------------------------ */

  function showInstall() {
    $('#stepName').classList.add('hidden');
    $('#stepInstall').classList.remove('hidden');
    $('#stepStatus').classList.remove('hidden');
    buildCommands();
    selectTab(detectTab());
    startPolling();
  }

  function save() {
    try {
      sessionStorage.setItem(STORE, JSON.stringify(state));
    } catch (_) {}
  }

  function restore() {
    try {
      var raw = sessionStorage.getItem(STORE);
      if (!raw) return false;
      var data = JSON.parse(raw);
      if (!data || !data.id || !data.key) return false;
      state = data;
      return true;
    } catch (_) {
      return false;
    }
  }

  /* ------------------------------------------------------------------ */

  function enroll() {
    var input = $('#deviceName');
    var name = safeName(input.value);
    var err = $('#nameErr');
    err.classList.add('hidden');

    if (!name) {
      err.textContent = 'Isi nama perangkat dulu, misalnya "HP Budi".';
      err.classList.remove('hidden');
      input.focus();
      return;
    }

    var btn = $('#startBtn');
    btn.disabled = true;
    btn.textContent = 'Menyiapkan…';

    fetch('/api/agent/enroll', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name }),
    })
      .then(function (res) {
        return res.json().then(function (body) {
          if (!res.ok || !body.ok) throw new Error(body.error || 'Gagal mendaftar (HTTP ' + res.status + ')');
          return body;
        });
      })
      .then(function (body) {
        state = { id: body.id, key: body.key, name: body.name };
        save();
        showInstall();
      })
      .catch(function (e) {
        err.textContent = e.message || 'Gagal mendaftar.';
        err.classList.remove('hidden');
      })
      .finally(function () {
        btn.disabled = false;
        btn.textContent = 'Lanjut';
      });
  }

  /* ------------------------------------------------------------------ */

  document.addEventListener('DOMContentLoaded', function () {
    var tabs = document.querySelectorAll('#tabs .tab');
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].addEventListener('click', function (e) {
        selectTab(e.currentTarget.getAttribute('data-tab'));
      });
    }

    var copies = document.querySelectorAll('[data-copy]');
    for (var j = 0; j < copies.length; j++) {
      copies[j].addEventListener('click', function (e) {
        var btn = e.currentTarget;
        var target = document.getElementById(btn.getAttribute('data-copy'));
        var text = target ? target.textContent : '';
        var done = function () {
          var old = btn.textContent;
          btn.textContent = 'Tersalin ✓';
          setTimeout(function () {
            btn.textContent = old;
          }, 1600);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(done).catch(function () {});
        } else {
          var area = document.createElement('textarea');
          area.value = text;
          document.body.appendChild(area);
          area.select();
          try {
            document.execCommand('copy');
            done();
          } catch (_) {}
          document.body.removeChild(area);
        }
      });
    }

    $('#startBtn').addEventListener('click', enroll);
    $('#deviceName').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') enroll();
    });

    if (restore()) {
      showInstall();
    }
  });
})();

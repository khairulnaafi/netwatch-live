# NetWatch Live — Cara Kerja Project

Dokumen ini menjelaskan mekanisme website NetWatch Live: bagaimana data didapat, bagaimana diproses, dan bagaimana tampil di browser. Ditulis untuk bahan presentasi.

---

## 1. Ringkasan

NetWatch Live adalah dashboard monitoring jaringan yang berjalan **di komputer sendiri** (bukan di cloud). Aplikasi ini mengambil data langsung dari sistem operasi — ping, tabel ARP, scan Wi-Fi, counter jaringan — lalu menampilkannya sebagai dashboard real-time.

Karena berjalan lokal, data yang dilihat adalah **kondisi jaringan di sekitar komputer itu**, bukan data pusat atau data palsu.

```
 Perangkat jaringan  ──┐
 (router, HP, laptop)  │
                       ├──► Komputer (server.js)  ──► Browser (dashboard)
 DNS query (UDP 53) ───┤        │
 Agent HP (HTTP)    ───┘        └──► Telegram / WhatsApp (alert)
```

---

## 2. Dari mana datanya?

Semua data berasal dari 3 sumber:

| Sumber | Data yang didapat | Cara ambil | Frekuensi |
|---|---|---|---|
| **Perintah Windows** | Latency, packet loss, daftar perangkat, Wi-Fi sekitar, throughput | `ping`, `arp -a`, `netsh wlan`, `netstat -e`, `ipconfig` | 3 detik (ping), 20–30 detik (scan) |
| **DNS Logger** | Nama domain yang dibuka tiap perangkat + perkiraan aplikasi | Server DNS sendiri di UDP port 53 | Real-time |
| **Agent** (APK/Termux/PC) | Wi-Fi di sekitar HP pengguna | HTTP `POST /api/agent/ingest` | Tiap 30 detik |

### 2.1 Perintah Windows

- **`ping`** → mengecek apakah perangkat hidup dan berapa latency-nya (ms). Kalau gagal, dicoba sekali lagi agar packet loss sesaat tidak langsung dianggap offline.
- **`arp -a`** → daftar IP + MAC perangkat yang pernah berkomunikasi di jaringan lokal. MAC dipakai untuk menebak merek perangkat (Apple, Samsung, Xiaomi, dll).
- **`netsh wlan show networks mode=bssid`** → daftar Wi-Fi di sekitar: SSID, sinyal, channel, band 2.4/5 GHz, keamanan.
- **`netsh wlan show interfaces`** → Wi-Fi yang sedang tersambung.
- **`netstat -e`** → total byte masuk/keluar. Selisih antar pengukuran diubah menjadi Mbps.
- **`ipconfig` / `route print`** → IP komputer dan gateway (dipakai untuk target "auto").

### 2.2 DNS Logger

Aplikasi menjalankan server DNS sendiri di **UDP port 53**. Perangkat yang memakai komputer ini sebagai DNS akan mengirim pertanyaan seperti "apa IP youtube.com?" — dan logger mencatat:

- nama domain,
- IP perangkat yang bertanya,
- waktu query.

Query tetap diteruskan ke DNS upstream (default `8.8.8.8`), jadi internet tetap normal.

Dari nama domain, sistem menebak aplikasinya lewat `lib/apps.js`:

| Domain | Perkiraan aplikasi |
|---|---|
| `googlevideo.com`, `ytimg.com` | YouTube |
| `tiktokcdn.com`, `tiktokv.com` | TikTok |
| `cdninstagram.com` | Instagram |
| `susercontent.com` | Shopee |

Ini **perkiraan**, bukan deteksi aplikasi sungguhan.

### 2.3 Agent

Untuk melihat Wi-Fi di lokasi lain (misalnya HP teman), ada agent yang dijalankan di perangkat itu:

- **APK Android** (`agent/netwatch.apk`), atau
- **Termux/script** untuk Android tanpa APK, atau
- **PowerShell** untuk Windows.

Agent memakai *device key* masing-masing, lalu mengirim hasil scan Wi-Fi ke server lewat HTTP. Data itu muncul sebagai "lokasi" terpisah di dashboard.

---

## 3. Frontend dan Backend

| Bagian | Teknologi | Keterangan |
|---|---|---|
| **Backend** | Node.js murni (modul `http`) | Tanpa framework, tanpa library pihak ketiga. Semua dependensi = 0. |
| **Frontend** | HTML + CSS + JavaScript vanilla | Tanpa React/Vue, tanpa CDN. |
| **Grafik** | Canvas API (`public/js/charts.js`) | Digambar manual, tanpa Chart.js. |
| **Komunikasi** | SSE (`/api/stream`) + fallback polling 3 detik | SSE = server mendorong data ke browser. |
| **Penyimpanan** | File JSON (`config.json`, `device-keys.json`) | Tanpa database. |

Struktur utama:

```
server.js          → HTTP server, routing, autentikasi, SSE
lib/monitor.js     → otak: siklus monitoring, status, alert
lib/network.js     → ping, ARP, throughput, IP/gateway
lib/wifi.js        → scan Wi-Fi & daftar klien
lib/dnslog.js      → server DNS + pencatatan domain
lib/apps.js        → pemetaan domain → aplikasi
lib/notifier.js    → kirim alert Telegram/WhatsApp
public/            → dashboard (index.html, app.js, charts.js, style.css)
android/           → sumber APK agent
api/index.js       → versi demo untuk Vercel (tanpa data live)
```

---

## 4. Alur kerja satu siklus

Setiap **3 detik** (mode live):

1. Server membaca gateway dan IP komputer.
2. Semua perangkat target di-ping secara paralel.
3. Hasil ping diubah menjadi status: `up`, `warning`, atau `down`.
4. Counter jaringan dibaca → dihitung jadi Mbps masuk/keluar.
5. Data disimpan ke riwayat (maksimal 90 titik per perangkat).
6. Kalau status berubah, server membuat *event* dan mengirim alert.
7. Snapshot lengkap dikirim ke semua browser lewat SSE.
8. Browser menggambar ulang angka, grafik, dan tabel.

Tugas berat dijalankan lebih jarang supaya ringan:

- scan Wi-Fi sekitar: tiap **20 detik**,
- refresh daftar klien: tiap **30 detik**.

---

## 5. Bagaimana status dan alert ditentukan

| Kondisi | Status |
|---|---|
| Ping berhasil, latency ≤ 120 ms | **Online** (hijau) |
| Ping berhasil, latency > 120 ms atau loss > 5% | **Warning** (kuning) |
| Ping gagal | **Offline** (merah) |

Saat status berubah, server:

1. mencatat event di tab **Notifikasi**,
2. mengirim pesan ke Telegram/WhatsApp (kalau diaktifkan),
3. menunggu **60 detik** sebelum boleh mengirim alert lagi untuk perangkat yang sama (anti-spam).

---

## 6. Cara data sampai ke browser

Dua jalur, dipakai bergantian:

- **SSE** (`/api/stream`) — koneksi tetap; server mengirim snapshot setiap siklus. Ini yang dipakai normal.
- **Polling** — kalau SSE tidak tersedia, browser memanggil `/api/state` tiap 3 detik.

Semua data yang tampil berasal dari satu fungsi: `monitor.snapshot()`.

---

## 7. Mode demo vs mode live

| | Demo | Live |
|---|---|---|
| Data | Simulasi (`lib/demo.js`) | Nyata dari jaringan |
| Kebutuhan | Cukup Node.js | Harus di komputer yang terhubung jaringan |
| Cocok untuk | Pameran tampilan | Monitoring sungguhan |

Deployment **Vercel hanya bisa mode demo**, karena Vercel tidak menjalankan proses terus-menerus dan tidak bisa memakai `ping`/`netsh`/DNS UDP. Untuk live, `server.js` harus jalan di komputer/VPS.

---

## 8. Keamanan dan izin

- **Login**: Basic Auth, ditambah link admin `?k=<token>` yang membuat cookie sesi 1 tahun.
- **Link publik `/join`**: hanya untuk pendaftaran perangkat, tanpa membuka dashboard.
- **Device key per perangkat**: setiap agent punya kunci sendiri (berlaku 7 hari), jadi kunci utama tidak dibagikan.
- **Firewall**: aturan DNS dibatasi ke `LocalSubnet` (hanya jaringan lokal).
- **Etika**: hanya untuk jaringan/perangkat yang Anda miliki atau punya izin. DNS logger mencatat domain, bukan isi komunikasi.

---

## 9. Batasan yang perlu disebut saat presentasi

1. **Tidak bisa membaca isi HTTPS** — hanya nama domain.
2. **Private DNS / DoH** di perangkat membuat domain tidak terlihat.
3. **Hotspot dari HP tidak bisa dipantau** — Android tidak memberi akses ke trafik tethering. Yang bisa: PC dijadikan hotspot.
4. **Aplikasi hanya perkiraan** dari domain; aplikasi offline (galeri, game offline) tidak terlihat.
5. **Vercel tidak bisa live** — hanya demo.
6. **Tunnel Cloudflare gratis berganti URL** setiap restart.
7. **Data disimpan di memori** (DNS maksimal 300 entri) dan hilang saat server berhenti.

---

## 10. Ringkasan untuk presentasi (5 poin)

1. **Lokal, bukan cloud** — data diambil langsung dari sistem operasi komputer.
2. **Tiga sumber data** — perintah Windows, DNS logger, dan agent di perangkat.
3. **Backend Node.js tanpa dependency, frontend vanilla JS** — ringan dan mudah dijalankan.
4. **Real-time** — siklus 3 detik lewat SSE, dengan fallback polling.
5. **Jujur soal batas** — hanya domain (bukan isi HTTPS), aplikasi hanya perkiraan, dan hanya untuk jaringan yang diizinkan.

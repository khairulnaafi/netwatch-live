# NetWatch Agent

Agent kecil yang dijalankan di **perangkat teman**. Tugasnya memindai Wi-Fi di sekitar perangkat itu, lalu mengirim hasilnya ke dashboard NetWatch Anda.

Ini diperlukan karena **browser tidak bisa** memindai daftar Wi-Fi di sekitar pengunjung. Tanpa agent, dashboard hanya menampilkan Wi-Fi di sekitar komputer yang menjalankan server.

## Cara paling mudah: halaman `/join`

Buka `https://ALAMAT-DASHBOARD/join` lalu kirim tautannya ke teman. Halaman itu memandu
sendiri: pilih perangkat, salin perintah (alamat + kunci sudah terisi otomatis), lalu
menampilkan daftar Wi-Fi di sekitar perangkat teman Anda.

Setiap perangkat yang mendaftar lewat `/join` mendapat kunci sendiri yang hanya bisa
menulis ke lokasinya sendiri dan berlaku 7 hari.

## Yang dibutuhkan dari Anda (pemilik dashboard)

1. Dashboard live sedang berjalan (misalnya lewat `start-live.bat`).
2. **Kunci agent** dari `config.json` → `agent.key`.
3. Alamat tunnel, contoh `https://xxxxx.trycloudflare.com`.

Kirim ketiganya ke teman Anda. Jangan kirim password dashboard — kunci agent hanya bisa mengirim data, tidak bisa membuka dashboard.

## Windows (paling mudah)

1. Kirim folder `agent/` ke teman Anda (WhatsApp/ZIP).
2. Teman mengekstrak, lalu klik dua kali **`agent.bat`**.
3. Isi alamat dashboard, kunci agent, dan nama lokasi (contoh: `Laptop Budi`).
4. Biarkan jendelanya terbuka.

Data akan muncul di dashboard → **Wi-Fi & Klien** → dropdown **Lokasi dipantau**.

Ingin tanpa isi ulang setiap kali? Buat `agent-config.txt` di folder yang sama:

```
https://xxxxx.trycloudflare.com
KUNCI_AGENT
Laptop Budi
```

Baris 1 alamat, baris 2 kunci, baris 3 nama lokasi.

## Android (Termux)

Butuh dua aplikasi dari **F-Droid** (bukan Play Store):

1. **Termux** — terminal untuk Android
2. **Termux:API** — jembatan agar Termux bisa membaca Wi-Fi

Keduanya harus dipasang. Termux saja tidak cukup.

### Cara tercepat: satu perintah

Buka Termux, tempel ini (ganti alamat & kunci):

```bash
curl -sL https://xxxxx.trycloudflare.com/agent/setup.sh | bash -s -- \
  https://xxxxx.trycloudflare.com KUNCI_AGENT "HP Budi"
```

Script akan otomatis memasang paket, memeriksa aplikasi Termux:API, memeriksa izin lokasi, lalu menjalankan agent. Kalau ada yang kurang, script memberi tahu persis apa yang harus diperbaiki.

### Cara manual

```bash
pkg update && pkg install -y termux-api jq curl
curl -sL https://xxxxx.trycloudflare.com/agent/termux.sh -o termux.sh
bash termux.sh https://xxxxx.trycloudflare.com KUNCI_AGENT "HP Budi"
```

### Kalau data tidak muncul

Agent akan memberi pesan yang jelas. Penyebab paling umum:

- **Aplikasi Termux:API belum terpasang** → ambil dari F-Droid.
- **Izin Lokasi belum diberikan** → Settings → Apps → Termux:API → Permissions → Location → Allow.
- **GPS/Lokasi di HP mati** → nyalakan.
- **Wi-Fi di HP mati** → nyalakan (scan tetap butuh Wi-Fi aktif).
- **Kunci agent salah** → agent berhenti dengan pesan `KUNCI AGENT SALAH`.

Catatan:

- Android membatasi frekuensi scan; default interval 30 detik sudah aman.
- Beberapa HP mengembalikan SSID `<unknown ssid>` bila izin lokasi belum diberikan.
- Biarkan Termux tetap terbuka. Agent memakai `termux-wake-lock` supaya tidak dimatikan Android.

## Linux / macOS

```bash
chmod +x agent.sh
./agent.sh https://xxxxx.trycloudflare.com KUNCI_AGENT "Laptop Budi"
```

- **Linux** memakai `nmcli` (NetworkManager). Pastikan perintah `nmcli` tersedia.
- **macOS** memakai `airport`, yang bisa tidak tersedia di macOS Sonoma ke atas.

## Catatan

- Agent hanya mengirim **nama Wi-Fi (SSID), sinyal, channel, band, keamanan**, daftar klien ARP, dan info jaringan dasar. Tidak ada isi trafik, password, atau data pribadi.
- Data disimpan di memori server dan hilang saat server dimatikan.
- Lokasi dianggap **offline** bila tidak mengirim data lebih dari 2 menit.
- Hanya scan jaringan yang Anda miliki atau yang Anda punya izin untuk memantau.

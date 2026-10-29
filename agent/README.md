# NetWatch Agent

Agent kecil yang dijalankan di **perangkat teman**. Tugasnya memindai Wi-Fi di sekitar perangkat itu, lalu mengirim hasilnya ke dashboard NetWatch Anda.

Ini diperlukan karena **browser tidak bisa** memindai daftar Wi-Fi di sekitar pengunjung. Tanpa agent, dashboard hanya menampilkan Wi-Fi di sekitar komputer yang menjalankan server.

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

Butuh dua aplikasi dari **F-Droid** (bukan Play Store): **Termux** dan **Termux:API**.

```bash
pkg update && pkg install termux-api jq curl
chmod +x termux.sh
./termux.sh https://xxxxx.trycloudflare.com KUNCI_AGENT "HP Budi"
```

Syarat penting:

- Izin **Lokasi** untuk Termux:API harus diaktifkan (Settings → Apps → Termux:API → Permissions → Location).
- **GPS/Lokasi** di HP harus menyala.
- Android membatasi frekuensi scan; default interval 30 detik sudah aman.
- Beberapa HP mengembalikan SSID `<unknown ssid>` bila izin lokasi belum diberikan.

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

# NetWatch Agent — APK Android

Aplikasi kecil (21 KB) yang memindai Wi-Fi di sekitar HP lalu mengirimnya ke dashboard
NetWatch. Tanpa Termux, tanpa root, tanpa layanan pihak ketiga.

## Cara pakai (untuk pengguna)

1. Buka `https://ALAMAT-DASHBOARD/join` di browser HP.
2. Isi nama perangkat → salin **Kode aplikasi**.
3. Unduh `netwatch.apk` dari halaman itu, lalu buka filenya.
   Izinkan **Instal dari sumber tidak dikenal** bila diminta.
4. Tempel kode → tekan **Mulai memantau** → izinkan **Lokasi** (dan **Perangkat di
   sekitar** di Android 13+) → nyalakan **GPS**.

Data terkirim tiap 30 detik. Notifikasi NetWatch harus tetap aktif supaya Android
tidak mematikan pemantauan. Kalau Android mematikan aplikasinya, pemantauan
menyala sendiri memakai kode terakhir.

## Membangun ulang APK

Butuh JDK 17+ dan Android SDK (build-tools + platform). Tanpa Gradle.

```bash
bash android/build.sh
```

Hasil: `agent/netwatch.apk` (ditandatangani dengan `android/netwatch.jks`).

Keystore itu **jangan dihapus**: kalau berubah, tanda tangan APK ikut berubah dan
pengguna harus menghapus aplikasi lama sebelum memasang versi baru. Naikkan
`VERSION_CODE` setiap kali merilis versi baru.

Variabel opsional:

| Variabel | Default |
|---|---|
| `ANDROID_SDK` | `%LOCALAPPDATA%\Android\Sdk` |
| `JAVA_HOME` | `C:\Program Files\Android\Android Studio\jbr` |
| `BUILD_TOOLS` | `36.0.0` |
| `PLATFORM` | `android-34` |
| `VERSION_CODE` | `2` |
| `VERSION_NAME` | `1.1` |

## Isi kode perangkat

Halaman `/join` membuat kode:

```
base64url("https://alamat-server|KUNCI_PERANGKAT|Nama Perangkat")
```

Kode ini hanya berisi kunci perangkat (bukan kunci utama dashboard). Kunci itu
hanya bisa menulis ke lokasi miliknya sendiri dan kedaluwarsa setelah 7 hari.

## Izin yang dipakai

| Izin | Kenapa |
|---|---|
| `ACCESS_FINE_LOCATION` | Android mewajibkan izin lokasi untuk membaca daftar Wi-Fi |
| `NEARBY_WIFI_DEVICES` | Wajib di Android 13+ untuk memindai Wi-Fi di sekitar |
| `ACCESS_WIFI_STATE`, `CHANGE_WIFI_STATE` | Memicu dan membaca hasil scan |
| `INTERNET` | Mengirim hasil scan ke dashboard |
| `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_LOCATION`, `FOREGROUND_SERVICE_DATA_SYNC` | Agar pemantauan tetap berjalan saat layar mati; tipe `location` diperlukan supaya Android mengizinkan scan dari latar depan |
| `POST_NOTIFICATIONS` | Menampilkan status pemantauan |

Tidak ada akses kontak, kamera, mikrofon, SMS, atau penyimpanan.

## Struktur

```
android/
├─ AndroidManifest.xml
├─ build.sh                 aapt2 + javac + d8 + apksigner
├─ res/drawable/            ikon aplikasi (vektor)
└─ src/com/netwatch/agent/
   ├─ MainActivity.java     layar utama: tempel kode, mulai/hentikan
   ├─ AgentService.java     foreground service: scan tiap 30 detik + POST
   └─ DeviceCode.java       decode kode perangkat
```

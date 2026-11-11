# Prompt Tambahan — Aspek Keamanan Web & Jaringan

File ini berisi dua bagian:

- **Bagian A** — prompt tambahan yang siap Anda tempel ke prompt laporan magang Anda.
- **Bagian B** — penjelasan singkat untuk Anda, supaya paham dan bisa menjawab kalau ditanya dosen/supervisor.

Semua kontrol keamanan di bawah sudah saya cocokkan langsung dengan kode proyek (`server.js`, `lib/monitor.js`, `lib/dnslog.js`, `public/js/app.js`, `.gitignore`, `config.json`), bukan asumsi.

---

# BAGIAN A — PROMPT SIAP TEMPEL

Tempel blok di bawah ini **setelah bagian 9 (Etika Akademik)** dan **sebelum bagian 10 (Hasil Akhir)** pada prompt utama Anda.

```text
## 12. PENAMBAHAN WAJIB — ASPEK KEAMANAN WEB DAN JARINGAN

Bagian ini menambahkan sudut pandang Network & Security Engineering ke dalam
laporan. Jangan membuat bab baru di luar BAB I dan BAB II. Integrasikan ke
dalam struktur yang sudah ada, dengan tambahan satu subbab baru di BAB II.

### 12.1 Tujuan penambahan

Laporan harus menunjukkan bahwa proyek tidak hanya "menampilkan data", tetapi
juga memperhatikan keamanan jaringan dan keamanan aplikasi web. Pembahasan
keamanan harus:

1. Menjelaskan konsep dasar keamanan jaringan dan keamanan aplikasi web.
2. Menjelaskan lapisan keamanan yang diterapkan pada sistem.
3. Menjelaskan kontrol keamanan yang benar-benar ada di kode.
4. Menjelaskan batasan keamanan secara jujur.
5. Tidak mengklaim sistem sebagai pendeteksi serangan, IDS, atau antivirus.

### 12.2 Subbab baru: 2.10 Keamanan Web dan Jaringan pada Sistem Monitoring

Panjang 2–3 halaman. Susun dengan urutan berikut.

#### a. Konsep dasar keamanan jaringan

Jelaskan secara ringkas dan saling terhubung:

- Pengertian keamanan jaringan dan keamanan aplikasi web.
- CIA Triad: Confidentiality, Integrity, Availability — beri contoh yang
  relevan dengan sistem monitoring (misalnya: data domain adalah confidential,
  data pembacaan ping harus integrity, dashboard harus availability).
- Prinsip defense in depth (keamanan berlapis).
- Prinsip least privilege (hak minimum).
- Prinsip minimize attack surface (memperkecil permukaan serangan).
- Prinsip secure by default (pengaturan awal sudah aman).
- Perbedaan authentication (siapa Anda) dan authorization (apa yang boleh
  Anda lakukan).
- Pengertian ancaman, kerentanan, dan risiko.
- Ringkasan OWASP Top 10 sebagai kerangka umum kerentanan aplikasi web.
  Sebutkan hanya kategori yang relevan dengan proyek, misalnya Broken Access
  Control, Injection, Security Misconfiguration, dan Cross-Site Scripting.
  Jangan membahas seluruh kategori secara detail.

#### b. Keamanan berlapis pada sistem

Jelaskan bahwa keamanan diterapkan berlapis, bukan satu titik:

| Lapisan | Fokus | Contoh pada sistem |
|---|---|---|
| Jaringan | siapa yang bisa mencapai layanan | dashboard hanya localhost, DNS dibatasi subnet lokal |
| Transport | data tidak disadap saat lewat internet | HTTPS pada tunnel Cloudflare |
| Aplikasi | siapa yang boleh masuk dan apa yang boleh dilakukan | autentikasi, token sesi, kunci agent terpisah |
| Data | data apa yang dikumpulkan | hanya metadata domain, bukan isi komunikasi |
| Operasional | pengelolaan rahasia dan konfigurasi | kredensial tidak masuk repositori, kunci kedaluwarsa |

#### c. Kontrol keamanan yang benar-benar diterapkan

Buat tabel dengan kolom: **No | Kontrol | Cara kerja | Bukti implementasi | Status**.

Isi hanya kontrol yang ada di kode. Kontrol yang terverifikasi:

1. Dashboard hanya mendengarkan di 127.0.0.1 (host default di config.json),
   sehingga tidak dapat diakses langsung dari jaringan lokal.
2. Autentikasi Basic Auth dengan perbandingan waktu-konstan
   (crypto.timingSafeEqual) untuk mengurangi timing attack.
3. Link admin memakai token turunan SHA-256 dari kredensial, disimpan sebagai
   cookie sesi dengan atribut HttpOnly, SameSite=Lax, dan Secure saat HTTPS.
4. Pemisahan otorisasi: halaman publik /join dan endpoint agent tidak memakai
   password dashboard.
5. Endpoint /api/agent/ingest memakai kunci agent sendiri (header X-Agent-Key),
   bukan kredensial admin.
6. Kunci perangkat hasil pendaftaran terikat pada satu ID lokasi, sehingga satu
   perangkat tidak dapat menulis data ke lokasi perangkat lain.
7. Kunci perangkat memiliki masa berlaku 7 hari.
8. Security header: Content-Security-Policy, X-Content-Type-Options: nosniff,
   X-Frame-Options: SAMEORIGIN, Referrer-Policy: no-referrer.
9. Pencegahan path traversal pada penyajian file statis: penolakan karakter
   NUL, normalisasi path, dan pengecekan bahwa file tetap berada di dalam
   direktori public.
10. Batas ukuran body request 128 KB untuk mencegah pengiriman data berlebihan.
11. Pencegahan XSS di frontend: seluruh data dinamis di-escape sebelum
    dimasukkan ke DOM.
12. Validasi input agent: pembersihan karakter kontrol, pembatasan panjang,
    validasi MAC unicast, validasi rentang IP, dan pembatasan jumlah data.
13. Minimalisasi data: DNS logger hanya mencatat nama domain, IP klien, tipe
    query, dan waktu — bukan isi komunikasi.
14. Halaman /join sengaja tidak mengirim BSSID dan daftar klien perangkat lain.
15. Rahasia tidak masuk repositori: config.json, device-keys.json, file
    kredensial, dan keystore APK tercantum di .gitignore.
16. Firewall membatasi akses DNS UDP port 53 hanya ke LocalSubnet.

#### d. Keterbatasan keamanan yang wajib ditulis jujur

Tuliskan bahwa sistem ini **belum** memiliki:

- rate limiting atau penguncian akun pada percobaan login;
- autentikasi multifaktor (MFA);
- TLS pada jaringan lokal (komunikasi lokal masih HTTP; HTTPS hanya pada
  tunnel publik);
- IDS/IPS atau deteksi serangan otomatis;
- enkripsi data saat disimpan (data berada di memori dan hilang saat server
  berhenti);
- audit log permanen;
- token CSRF eksplisit (mitigasi sebagian oleh SameSite=Lax).

Nyatakan bahwa sistem bersifat **monitoring dan observability**, bukan alat
pencegahan serangan.

#### e. Rekomendasi penguatan

Beri 4–6 rekomendasi realistis, misalnya: rate limiting login, TLS lokal,
penyimpanan log terpusat, rotasi kunci agent, autentikasi berbasis peran, dan
pembatasan akses dashboard melalui VPN.

### 12.3 Penyesuaian subbab yang sudah ada

- **1.1 Latar Belakang**: tambahkan satu paragraf tentang pentingnya keamanan
  jaringan dan keterbatasan visibilitas administrator terhadap aktivitas
  jaringan.
- **1.6 Ruang Lingkup dan Batasan**: tambahkan bahwa laporan membahas keamanan
  aplikasi web dan jaringan pada tingkat konfigurasi dan kontrol akses, serta
  menegaskan yang tidak dibahas: pembacaan payload, penetration testing tanpa
  izin, dan deteksi malware.
- **2.4 Network Security**: tambahkan bahwa monitoring termasuk kontrol
  **detektif** (detective control), bukan preventif, dan hubungkan dengan
  konsep visibility.
- **2.8 Teknologi Pendukung**: sebutkan mekanisme keamanan yang menyertai
  teknologi yang dipakai (header HTTP, cookie, CSP, firewall), bukan hanya
  nama bahasa pemrograman.

### 12.4 Tabel wajib: pemetaan aset–ancaman–kontrol

Buat satu tabel dengan kolom:
**Aset | Ancaman | Dampak | Kontrol yang ada | Sisa risiko**.

Contoh baris yang boleh dipakai (sesuaikan dengan implementasi):

- Kredensial dashboard | penyadapan saat login | akun diambil alih | HTTPS pada
  tunnel, cookie HttpOnly | tetap ada risiko bila diakses lewat HTTP lokal.
- Endpoint agent | pengiriman data palsu | data monitoring tidak valid | kunci
  agent, validasi input | kunci bocor dapat menyalahgunakan endpoint.
- Data domain pengguna | penyalahgunaan data | pelanggaran privasi | minimalisasi
  data, akses terbatas | metadata tetap dapat mengungkap pola aktivitas.
- Dashboard | akses tidak sah | kebocoran informasi jaringan | bind localhost,
  autentikasi | belum ada rate limiting.

### 12.5 Aturan klaim keamanan

DILARANG menulis:

- "sistem mendeteksi serangan/serangan siber/malware/penyadapan";
- "sistem mencegah peretasan";
- "sistem aman sepenuhnya" atau "tidak dapat ditembus";
- "sistem memantau isi komunikasi pengguna".

WAJIB menulis:

- "sistem mencatat metadata dan menampilkan indikasi kondisi jaringan";
- "keamanan diterapkan secara berlapis pada konfigurasi dan kontrol akses";
- "sistem memiliki keterbatasan yang dijelaskan pada subbab 2.10.d".

### 12.6 Gaya penulisan bagian keamanan

- Bahasa Indonesia formal dan akademis.
- Setiap kontrol dijelaskan dengan pola: **apa → kenapa perlu → bagaimana
  diterapkan → bukti**.
- Hindari istilah asing tanpa penjelasan singkat.
- Jangan menyalin potongan kode panjang; cukup sebut nama fungsi atau file.
- Setiap klaim teknis harus dapat dilacak ke file proyek.

### 12.7 Referensi keamanan

Gunakan minimal 3 sumber tambahan yang benar-benar ada dan dapat diverifikasi,
misalnya:

- OWASP Foundation. (2021). OWASP Top 10:2021.
- NIST. (2020). SP 800-53 Rev. 5 — Security and Privacy Controls.
- NIST. (2008). SP 800-115 — Technical Guide to Information Security Testing.
- IETF. (1987). RFC 1035 — Domain Names: Implementation and Specification.
- IETF. (2018). RFC 8446 — The Transport Layer Security (TLS) Protocol 1.3.
- ISO/IEC. (2022). ISO/IEC 27001:2022 — Information Security Management Systems.

Verifikasi judul, tahun, dan URL sebelum mencantumkan. Jangan mengarang DOI.

### 12.8 Hasil tambahan yang harus diserahkan

1. Subbab 2.10 lengkap di dalam dokumen Word yang sama.
2. Tabel kontrol keamanan (12.2.c) dan tabel aset–ancaman–kontrol (12.4).
3. Daftar keterbatasan keamanan (12.2.d) dan rekomendasi (12.2.e).
4. Catatan singkat: kontrol mana yang sudah diterapkan dan mana yang masih
   rekomendasi.
```

---

# BAGIAN B — PENJELASAN UNTUK ANDA

## B.1 Dasar keamanan jaringan (versi singkat)

Keamanan jaringan itu intinya menjaga tiga hal — biasa disebut **CIA Triad**:

| Aspek | Artinya | Contoh di proyek ini |
|---|---|---|
| **Confidentiality** | data tidak boleh dibaca pihak yang tidak berhak | dashboard hanya bisa dibuka admin; DNS hanya mencatat domain |
| **Integrity** | data tidak boleh diubah diam-diam | hasil ping dan data agent divalidasi sebelum disimpan |
| **Availability** | layanan tetap bisa dipakai | server berjalan lokal, DNS tetap meneruskan query ke upstream |

Di atas itu ada beberapa prinsip yang dipakai di mana-mana:

- **Defense in depth** — jangan bergantung pada satu pengaman. Di proyek ini: bind localhost → autentikasi → cookie HttpOnly → CSP → firewall.
- **Least privilege** — beri hak sekecil mungkin. Agent hanya boleh menulis ke lokasi miliknya sendiri.
- **Minimize attack surface** — tutup yang tidak perlu. Dashboard tidak terbuka ke LAN; hanya DNS UDP 53 yang dibuka, itu pun dibatasi `LocalSubnet`.
- **Secure by default** — pengaturan awal sudah aman. `host` default `127.0.0.1`, bukan `0.0.0.0`.
- **Authentication vs Authorization** — autentikasi = "siapa kamu" (login), otorisasi = "kamu boleh apa" (token agent hanya untuk ingest).

## B.2 Lapisan keamanan yang benar-benar ada

### Lapisan 1 — Jaringan

- Dashboard hanya mendengarkan di `127.0.0.1:8787`. Dari HP atau laptop lain, alamat itu **tidak bisa dibuka**. Ini menutup sebagian besar permukaan serangan.
- Satu-satunya port yang terbuka ke LAN adalah **UDP 53** untuk DNS logger.
- Firewall rule `NetWatch DNS (UDP 53)` dibatasi `RemoteAddress LocalSubnet`, jadi hanya perangkat di jaringan yang sama yang bisa memakai DNS ini.

**Kenapa penting:** kalau dashboard terbuka ke jaringan, siapa pun di Wi-Fi yang sama bisa mencoba menembak login. Dengan bind localhost, mereka tidak punya jalan masuk sama sekali.

### Lapisan 2 — Transport

- Di jaringan lokal, komunikasi masih **HTTP**. Ini keterbatasan yang harus Anda sebut jujur di laporan.
- Saat diakses dari luar (teman membuka `/join`), akses lewat **tunnel Cloudflare**, sehingga yang dilihat browser adalah **HTTPS**. TLS berhenti di edge Cloudflare, lalu diteruskan ke PC.

**Kenapa penting:** tanpa HTTPS, password dan cookie bisa disadap di jaringan publik. Tunnel memberi TLS tanpa perlu memasang sertifikat di PC.

### Lapisan 3 — Aplikasi (autentikasi & sesi)

- Login memakai **Basic Auth**, dibandingkan dengan `crypto.timingSafeEqual`.
- Link admin `?k=<token>` berisi hash SHA-256 dari `user:pass`, dipotong 32 karakter.
- Setelah link dibuka, server memasang cookie `nw_session` dengan:
  - `HttpOnly` → tidak bisa dibaca JavaScript (mengurangi dampak XSS),
  - `SameSite=Lax` → mengurangi CSRF,
  - `Secure` → hanya dikirim lewat HTTPS (otomatis saat diakses via tunnel),
  - `Max-Age=31536000` → berlaku 1 tahun.

**Kenapa `timingSafeEqual`:** perbandingan string biasa berhenti di karakter pertama yang beda. Waktu eksekusinya bisa dipakai menebak karakter password satu per satu. Perbandingan waktu-konstan menutup celah itu.

**Catatan jujur:** token di URL bisa tercatat di histori browser. Mitigasinya: `Referrer-Policy: no-referrer` dan cookie HttpOnly. Tapi ini tetap kelemahan yang layak disebut.

### Lapisan 4 — Otorisasi (pemisahan akses)

Ini bagian yang paling "security engineering":

- Password dashboard **tidak pernah dibagikan** ke teman.
- Teman membuka `/join` (publik), lalu mendapat **device key** sendiri.
- Device key itu **terikat pada satu ID lokasi** — kalau dipakai mengirim data dengan ID lokasi lain, server menimpanya dengan ID miliknya sendiri.
- Device key **kedaluwarsa 7 hari**.
- Endpoint `/api/agent/ingest` memeriksa header `X-Agent-Key`, bukan password admin.

**Kenapa penting:** ini penerapan **least privilege** dan **compartmentalization**. Satu kunci bocor hanya merusak satu perangkat, bukan seluruh sistem.

### Lapisan 5 — Keamanan aplikasi web

| Kontrol | Fungsinya |
|---|---|
| `Content-Security-Policy` | membatasi sumber script/style/gambar ke `'self'` → mengecilkan dampak XSS |
| `X-Content-Type-Options: nosniff` | mencegah browser menebak tipe file (mis. script disamarkan sebagai gambar) |
| `X-Frame-Options: SAMEORIGIN` | mencegah clickjacking lewat iframe |
| `Referrer-Policy: no-referrer` | mencegah URL (termasuk token) bocor ke situs lain |
| Escape `esc()` di frontend | semua data dinamis di-escape sebelum masuk DOM → mencegah XSS |
| Path traversal check | `..\..\windows\system32` ditolak; file hanya boleh dari folder `public` |
| Batas body 128 KB | mencegah request raksasa membanjiri server |

**Kenapa path traversal penting:** tanpa pengecekan, URL seperti `/../../config.json` bisa membocorkan kredensial. Di proyek ini sudah ditutup dengan normalisasi path + pengecekan prefix direktori.

### Lapisan 6 — Data (privasi)

- DNS logger hanya menyimpan: **nama domain, IP klien, tipe query, waktu**. Bukan isi halaman, bukan password, bukan chat.
- Halaman `/join` sengaja **tidak** mengirim BSSID dan daftar klien perangkat lain — teman hanya melihat Wi-Fi di sekitar dirinya.
- Data disimpan di memori, maksimal 300 entri, hilang saat server berhenti.

**Kenapa penting:** ini penerapan **data minimization**. Semakin sedikit data disimpan, semakin kecil risiko kalau bocor — dan lebih mudah dibenarkan secara etika.

### Lapisan 7 — Operasional

- `config.json`, `device-keys.json`, `live-auth.cmd`, dan keystore APK masuk `.gitignore` → kredensial tidak ikut ke GitHub.
- Kunci agent bisa diberikan lewat environment variable, bukan file.
- Kunci perangkat punya masa berlaku, jadi kunci lama tidak berlaku selamanya.

## B.3 Yang belum ada (sebutkan di laporan, jangan disembunyikan)

| Belum ada | Risiko |
|---|---|
| Rate limiting / lockout login | password bisa ditebak berulang kali |
| MFA | kalau password bocor, akun langsung diambil alih |
| TLS di jaringan lokal | traffic lokal bisa disadap |
| IDS/IPS | sistem tidak mendeteksi serangan otomatis |
| Enkripsi data saat disimpan | data di memori bisa dibaca proses lain di PC |
| Audit log permanen | tidak ada jejak siapa mengakses apa |
| Token CSRF eksplisit | sebagian tertutup `SameSite=Lax` |

Kalau ditanya "apakah sistem ini aman?", jawaban yang benar:

> "Sistem ini menerapkan keamanan berlapis pada konfigurasi dan kontrol akses — bind localhost, autentikasi waktu-konstan, cookie HttpOnly, CSP, validasi input, dan firewall terbatas subnet. Namun sistem ini adalah alat monitoring, bukan alat pencegahan serangan, dan masih memiliki keterbatasan seperti belum adanya rate limiting dan TLS di jaringan lokal."

## B.4 Cara menjelaskan di presentasi (30 detik)

> "Dari sisi keamanan, kami menerapkan defense in depth. Di lapisan jaringan, dashboard hanya listen di localhost dan port DNS dibatasi firewall ke subnet lokal. Di lapisan aplikasi, ada autentikasi Basic Auth dengan perbandingan waktu-konstan, cookie HttpOnly dan SameSite, serta security header seperti CSP. Untuk akses multi-perangkat, kami tidak membagikan password admin — setiap perangkat punya kunci sendiri yang terikat ke lokasinya dan kedaluwarsa dalam 7 hari. Dari sisi data, kami hanya mencatat metadata domain, bukan isi komunikasi. Kami juga jujur mencatat keterbatasannya: belum ada rate limiting, MFA, dan TLS di jaringan lokal."

## B.5 Kalimat kunci yang aman dipakai

- "monitoring metadata" — bukan "penyadapan".
- "indikasi aktivitas jaringan" — bukan "deteksi serangan".
- "kontrol akses" — bukan "sistem aman sepenuhnya".
- "keterbatasan yang diakui" — ini justru menaikkan nilai akademik laporan.

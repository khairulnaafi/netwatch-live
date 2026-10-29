#!/usr/bin/env bash
# NetWatch Live - pemasangan agent Android lewat Termux.
#
# Satu perintah (tempel di Termux):
#   curl -sL https://ALAMAT-DASHBOARD/agent/setup.sh | bash -s -- \
#     https://ALAMAT-DASHBOARD KUNCI_AGENT "HP Budi"
#
# Script ini akan:
#   1. memeriksa apakah dijalankan di Termux
#   2. memasang paket curl, jq, termux-api
#   3. memeriksa aplikasi Termux:API dan izin lokasi
#   4. menjalankan agent sampai Anda menekan Ctrl+C

set -uo pipefail

SERVER="${1:-}"
KEY="${2:-}"
NAME="${3:-}"

line() { printf '%s\n' "$*"; }
ok() { printf '  \033[32m[OK]\033[0m   %s\n' "$*"; }
bad() { printf '  \033[31m[GAGAL]\033[0m %s\n' "$*"; }
info() { printf '  \033[36m[..]\033[0m   %s\n' "$*"; }

line ""
line "  ============================================================"
line "   NETWATCH - Pemasangan agent Android (Termux)"
line "  ============================================================"
line ""

if [ -z "${PREFIX:-}" ] || ! command -v pkg >/dev/null 2>&1; then
  bad "Script ini harus dijalankan di dalam aplikasi Termux (Android)."
  exit 1
fi
ok "Berjalan di Termux"

# --- 1. Paket yang dibutuhkan -------------------------------------------
need=""
command -v curl >/dev/null 2>&1 || need="$need curl"
command -v jq >/dev/null 2>&1 || need="$need jq"
command -v termux-wifi-scaninfo >/dev/null 2>&1 || need="$need termux-api"

if [ -n "$need" ]; then
  info "Memasang paket:$need (bisa 1-3 menit, tunggu saja)"
  # shellcheck disable=SC2086
  if ! pkg install -y $need >/dev/null 2>&1; then
    info "Memperbarui daftar paket dulu..."
    pkg update -y >/dev/null 2>&1 || true
    # shellcheck disable=SC2086
    pkg install -y $need >/dev/null 2>&1 || true
  fi
fi

missing=""
command -v curl >/dev/null 2>&1 || missing="$missing curl"
command -v jq >/dev/null 2>&1 || missing="$missing jq"
command -v termux-wifi-scaninfo >/dev/null 2>&1 || missing="$missing termux-api"

if [ -n "$missing" ]; then
  bad "Paket ini belum terpasang:$missing"
  line ""
  line "  Jalankan manual lalu ulangi:"
  line "    pkg update && pkg install -y curl jq termux-api"
  exit 1
fi
ok "Paket curl, jq, termux-api siap"

# --- 2. Aplikasi Termux:API ---------------------------------------------
APP_OK=0
if command -v pm >/dev/null 2>&1 && pm list packages 2>/dev/null | grep -q 'com\.termux\.api'; then
  APP_OK=1
fi
if [ "$APP_OK" = "0" ]; then
  # Cadangan: kalau perintahnya bisa jalan, anggap aplikasinya ada.
  if termux-wifi-scaninfo >/dev/null 2>&1; then
    APP_OK=1
  fi
fi

if [ "$APP_OK" = "0" ]; then
  bad "Aplikasi 'Termux:API' belum terpasang."
  line ""
  line "  Aplikasi ini BEDA dengan Termux. Yang perlu dipasang:"
  line "    1. Termux            (sudah ada)"
  line "    2. Termux:API        <-- ini yang belum"
  line ""
  line "  Ambil dari F-Droid (gratis, bukan Play Store):"
  line "    https://f-droid.org/packages/com.termux.api/"
  line ""
  line "  Setelah terpasang, jalankan perintah ini lagi."
  exit 1
fi
ok "Aplikasi Termux:API terpasang"

# --- 3. Izin lokasi ------------------------------------------------------
SCAN_RAW=$(termux-wifi-scaninfo 2>&1 || true)
if printf '%s' "$SCAN_RAW" | grep -qiE 'permission|not allowed|denied|security exception'; then
  bad "Izin Lokasi untuk Termux:API belum diberikan."
  line ""
  line "  Cara memberi izin:"
  line "    Settings HP > Apps > Termux:API > Permissions > Location > Allow"
  line "    Lalu nyalakan juga GPS / Lokasi di HP."
  line ""
  line "  Setelah itu jalankan perintah ini lagi."
  exit 1
fi

SCAN_COUNT=$(printf '%s' "$SCAN_RAW" | jq 'if type == "array" then length else 0 end' 2>/dev/null || echo 0)
if [ "${SCAN_COUNT:-0}" = "0" ]; then
  bad "Belum ada Wi-Fi yang terbaca."
  line ""
  line "  Kemungkinan penyebab:"
  line "   - Izin Lokasi untuk Termux:API belum Allow"
  line "   - GPS / Lokasi di HP masih mati"
  line "   - Wi-Fi di HP sedang dimatikan"
  line ""
  line "  Nyalakan keduanya, lalu jalankan perintah ini lagi."
  exit 1
fi
ok "Wi-Fi terbaca: $SCAN_COUNT jaringan"

# --- 4. Alamat dashboard, kunci, nama -----------------------------------
ask() {
  # $1 = pertanyaan, $2 = nilai sekarang
  local answer=""
  if [ -r /dev/tty ]; then
    printf '  %s: ' "$1" >/dev/tty
    read -r answer </dev/tty || answer=""
  fi
  printf '%s' "$answer"
}

if [ -z "$SERVER" ]; then
  SERVER=$(ask "Alamat dashboard (contoh https://xxxxx.trycloudflare.com)")
fi
if [ -z "$KEY" ]; then
  KEY=$(ask "Kunci agent")
fi
if [ -z "$NAME" ]; then
  DEFAULT_NAME=$(getprop ro.product.model 2>/dev/null || echo "HP Android")
  NAME=$(ask "Nama lokasi (contoh: HP Budi) [$DEFAULT_NAME]")
  [ -z "$NAME" ] && NAME="$DEFAULT_NAME"
fi

if [ -z "$SERVER" ] || [ -z "$KEY" ]; then
  bad "Alamat dashboard dan kunci agent wajib diisi."
  exit 1
fi

case "$SERVER" in
  http://*|https://*) ;;
  *) SERVER="https://$SERVER" ;;
esac
SERVER="${SERVER%/}"

# --- 5. Ambil dan jalankan agent ----------------------------------------
AGENT_TMP="${TMPDIR:-$PREFIX/tmp}/netwatch-termux-agent.sh"
info "Mengunduh agent dari $SERVER"
if ! curl -fsSL -m 30 "$SERVER/agent/termux.sh" -o "$AGENT_TMP"; then
  bad "Gagal mengunduh agent. Periksa alamat dashboard dan koneksi internet."
  exit 1
fi
ok "Agent siap dijalankan"

line ""
line "  Semua siap. Data akan dikirim setiap 30 detik."
line "  Biarkan Termux tetap terbuka (boleh pindah aplikasi, jangan ditutup)."
line ""

exec bash "$AGENT_TMP" "$SERVER" "$KEY" "$NAME"

#!/usr/bin/env bash
# NetWatch Live - Agent Wi-Fi untuk Termux (Android)
#
# Kebutuhan (sekali saja):
#   pkg update && pkg install termux-api jq curl
#   Aplikasi "Termux:API" juga harus terpasang (dari F-Droid).
#   Izin Lokasi untuk Termux:API harus diaktifkan, dan GPS/Lokasi menyala.
#
# Pemakaian:
#   ./termux.sh https://xxxxx.trycloudflare.com KUNCI_AGENT "HP Budi"
#
# Variabel opsional:
#   INTERVAL=30 ./termux.sh ...   (detik antar kiriman, default 30)

set -uo pipefail

SERVER="${1:-}"
KEY="${2:-}"
NAME="${3:-$(getprop ro.product.model 2>/dev/null || echo 'HP Android')}"
INTERVAL="${INTERVAL:-30}"

if [ -z "$SERVER" ] || [ -z "$KEY" ]; then
  echo "Pemakaian: $0 <server> <kunci-agent> [nama-lokasi]"
  exit 1
fi

for cmd in termux-wifi-scaninfo termux-wifi-connectioninfo jq curl; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Perintah '$cmd' tidak ditemukan."
    echo "Jalankan: pkg install termux-api jq curl"
    echo "Pastikan aplikasi Termux:API juga terpasang."
    exit 1
  fi
done

SERVER="${SERVER%/}"
ID=$(printf '%s' "$NAME" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]\+/-/g; s/^-//; s/-$//')
[ -z "$ID" ] && ID="agent-android"

JQ_PROGRAM='
def band($f):
  if $f <= 0 then null
  elif $f < 3000 then "2.4 GHz"
  elif $f < 5925 then "5 GHz"
  else "6 GHz" end;

def chan($f):
  if $f <= 0 then null
  elif $f < 3000 then ((($f - 2407) / 5) | floor)
  elif $f < 5925 then ((($f - 5000) / 5) | floor)
  else null end;

def pct($l):
  ((($l + 100) * 2) | if . < 0 then 0 elif . > 100 then 100 else . end | floor);

def sec($c):
  if ($c | test("WPA3")) then "WPA3"
  elif ($c | test("WPA2")) then "WPA2"
  elif ($c | test("WPA")) then "WPA"
  elif ($c | test("WEP")) then "WEP"
  else "Terbuka" end;

def ssid_of($s):
  if ($s // "") == "" then "<tersembunyi>" else $s end;

{
  id: $id,
  location: $name,
  source: "termux-agent",
  wifi: {
    current: (
      if (($conn.ssid // "") == "" or (($conn.ssid // "") | test("unknown|^<"; "i"))) then null
      else {
        ssid: $conn.ssid,
        bssid: ($conn.bssid // null),
        signal: (($conn.rssi // -100) | pct(.)),
        channel: (($conn.frequency // 0) | chan(.)),
        band: (($conn.frequency // 0) | band(.)),
        security: null
      } end
    ),
    nearby: [
      $scan[]
      | select((.bssid // "") != "")
      | {
          ssid: ssid_of(.ssid),
          bssid: (.bssid | ascii_downcase),
          signal: ((.level // -100) | pct(.)),
          channel: ((.frequency // 0) | chan(.)),
          band: ((.frequency // 0) | band(.)),
          security: ((.capabilities // "") | sec(.))
        }
    ] | sort_by(-.signal) | .[0:100]
  },
  clients: [],
  network: {
    localIp: ($conn.ip // null),
    gateway: null,
    subnet: null
  }
}
'

echo ""
echo "  NetWatch Agent (Termux / Android)"
echo "  Server : $SERVER"
echo "  Lokasi : $NAME"
echo "  ID     : $ID"
echo ""
echo "  Tekan Ctrl+C untuk berhenti."
echo ""

while true; do
  SCAN=$(termux-wifi-scaninfo 2>/dev/null || echo '[]')
  CONN=$(termux-wifi-connectioninfo 2>/dev/null || echo '{}')

  if ! printf '%s' "$SCAN" | jq -e 'type == "array"' >/dev/null 2>&1; then
    SCAN='[]'
  fi
  if ! printf '%s' "$CONN" | jq -e 'type == "object"' >/dev/null 2>&1; then
    CONN='{}'
  fi

  PAYLOAD=$(jq -c -n --argjson scan "$SCAN" --argjson conn "$CONN" --arg id "$ID" --arg name "$NAME" "$JQ_PROGRAM")

  if curl -sS -m 25 -X POST "$SERVER/api/agent/ingest" \
      -H "x-agent-key: $KEY" \
      -H 'Content-Type: application/json; charset=utf-8' \
      --data-binary "$PAYLOAD" >/dev/null; then
    COUNT=$(printf '%s' "$PAYLOAD" | jq '.wifi.nearby | length')
    echo "[$(date +%H:%M:%S)] terkirim: $COUNT jaringan"
  else
    echo "[$(date +%H:%M:%S)] gagal mengirim, coba lagi nanti"
  fi

  sleep "$INTERVAL"
done

#!/usr/bin/env bash
# NetWatch Live - Agent Wi-Fi untuk Termux (Android)
#
# Cara termudah (satu perintah, dari dashboard):
#   curl -sL https://ALAMAT-DASHBOARD/agent/setup.sh | bash -s -- \
#     https://ALAMAT-DASHBOARD KUNCI_AGENT "HP Budi"
#
# Kalau semua kebutuhan sudah terpasang, boleh juga langsung:
#   ./termux.sh https://ALAMAT-DASHBOARD KUNCI_AGENT "HP Budi"
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
case "$SERVER" in
  http://*|https://*) ;;
  *) SERVER="https://$SERVER" ;;
esac

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
        security: (
          [ $scan[]
            | select((($conn.bssid // "") != "")
                     and ((.bssid | ascii_upcase) == ($conn.bssid | ascii_upcase)))
            | .capabilities ]
          | if length > 0 then (.[0] | sec(.)) else null end
        )
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

# Cegah Android mematikan Termux saat layar mati.
if command -v termux-wake-lock >/dev/null 2>&1; then
  termux-wake-lock >/dev/null 2>&1 || true
fi

echo ""
echo "  NetWatch Agent (Termux / Android)"
echo "  Server : $SERVER"
echo "  Lokasi : $NAME"
echo "  ID     : $ID"
echo ""
echo "  Biarkan Termux tetap terbuka. Tekan Ctrl+C untuk berhenti."
echo ""

EMPTY_HINT_SHOWN=0
AUTH_FAILED=0

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
  COUNT=$(printf '%s' "$PAYLOAD" | jq '.wifi.nearby | length' 2>/dev/null || echo 0)

  BODY="${TMPDIR:-${PREFIX:-/tmp}/tmp}/netwatch-agent-reply.json"
  CODE=$(curl -sS -m 25 -o "$BODY" -w '%{http_code}' \
    -X POST "$SERVER/api/agent/ingest" \
    -H "x-agent-key: $KEY" \
    -H 'Content-Type: application/json; charset=utf-8' \
    --data-binary "$PAYLOAD" 2>/dev/null) || CODE="000"

  STAMP=$(date +%H:%M:%S)
  case "$CODE" in
    200)
      echo "[$STAMP] terkirim: $COUNT jaringan"
      AUTH_FAILED=0
      ;;
    401)
      echo "[$STAMP] KUNCI AGENT SALAH. Minta kunci yang benar ke pemilik dashboard."
      AUTH_FAILED=1
      ;;
    000)
      echo "[$STAMP] tidak bisa menghubungi server (cek internet / alamat dashboard)"
      ;;
    *)
      echo "[$STAMP] server menolak (HTTP $CODE)"
      ;;
  esac

  if [ "$COUNT" = "0" ] && [ "$EMPTY_HINT_SHOWN" = "0" ]; then
    EMPTY_HINT_SHOWN=1
    echo ""
    echo "  Belum ada Wi-Fi yang terbaca. Biasanya karena izin lokasi."
    echo "  Ingat: Termux sendiri tidak punya menu izin lokasi (itu wajar)."
    echo "  Izin lokasi ada di aplikasi kedua, Termux:API:"
    echo "   1. Settings HP > Apps > Termux:API > Permissions > Location > Allow"
    echo "      (kalau tidak ada, cari 'Other permissions' / 'Additional permissions')"
    echo "   2. Nyalakan GPS / Lokasi di HP"
    echo "   3. Pastikan Wi-Fi HP menyala"
    echo ""
  fi

  if [ "$AUTH_FAILED" = "1" ]; then
    exit 1
  fi

  sleep "$INTERVAL"
done

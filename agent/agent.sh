#!/usr/bin/env bash
# NetWatch Live - Agent Wi-Fi untuk Linux dan macOS
#
# Linux  : memakai nmcli (NetworkManager)
# macOS  : memakai `airport` (mungkin tidak tersedia di macOS Sonoma ke atas)
#
# Pemakaian:
#   ./agent.sh https://xxxxx.trycloudflare.com KUNCI_AGENT "Laptop Budi"
#
# Variabel opsional:
#   INTERVAL=30 ./agent.sh ...

set -uo pipefail

SERVER="${1:-}"
KEY="${2:-}"
NAME="${3:-$(hostname 2>/dev/null || echo 'Laptop')}"
INTERVAL="${INTERVAL:-20}"
OS="$(uname -s)"

if [ -z "$SERVER" ] || [ -z "$KEY" ]; then
  echo "Pemakaian: $0 <server> <kunci-agent> [nama-lokasi]"
  exit 1
fi

SERVER="${SERVER%/}"
ID=$(printf '%s' "$NAME" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]\+/-/g; s/^-//; s/-$//')
[ -z "$ID" ] && ID="agent-laptop"

command -v curl >/dev/null 2>&1 || { echo "Butuh curl."; exit 1; }

json_escape() {
  printf '%s' "$1" | tr -d '\000-\037' | sed 's/\\/\\\\/g; s/"/\\"/g'
}

pct_from_rssi() {
  local rssi="${1:-"-100"}"
  local pct=$(( (rssi + 100) * 2 ))
  [ "$pct" -lt 0 ] && pct=0
  [ "$pct" -gt 100 ] && pct=100
  printf '%s' "$pct"
}

band_from_freq() {
  local f="${1:-0}"
  if [ "$f" -le 0 ]; then printf ''; elif [ "$f" -lt 3000 ]; then printf '2.4 GHz'; elif [ "$f" -lt 5925 ]; then printf '5 GHz'; else printf '6 GHz'; fi
}

channel_from_freq() {
  local f="${1:-0}"
  if [ "$f" -le 0 ]; then printf ''; elif [ "$f" -lt 3000 ]; then printf '%s' $(( (f - 2407) / 5 )); elif [ "$f" -lt 5925 ]; then printf '%s' $(( (f - 5000) / 5 )); fi
}

security_from() {
  local s
  s=$(printf '%s' "$1" | tr '[:lower:]' '[:upper:]')
  case "$s" in
    *WPA3*) printf 'WPA3' ;;
    *WPA2*) printf 'WPA2' ;;
    *WPA*)  printf 'WPA' ;;
    *WEP*)  printf 'WEP' ;;
    *)      printf 'Terbuka' ;;
  esac
}

scan_linux() {
  # SSID diletakkan paling akhir supaya ':' di dalam SSID tidak memecah kolom.
  nmcli -t -f SIGNAL,FREQ,SECURITY,SSID device wifi list --rescan yes 2>/dev/null | while IFS= read -r line; do
    [ -z "$line" ] && continue
    sig="${line%%:*}"; rest="${line#*:}"
    freq="${rest%%:*}"; rest="${rest#*:}"
    sec="${rest%%:*}"; ssid="${rest#*:}"
    freq="${freq%% *}"
    ssid=$(printf '%s' "$ssid" | sed 's/\\:/:/g; s/\\\\/\\/g')
    [ -z "$ssid" ] && ssid="<tersembunyi>"
    printf '%s\t%s\t%s\t%s\n' "$ssid" "$sig" "$freq" "$sec"
  done
}

scan_macos() {
  local airport="/System/Library/PrivateFrameworks/Apple80211.framework/Versions/Current/Resources/airport"
  [ -x "$airport" ] || return 1
  "$airport" -s 2>/dev/null | tail -n +2 | awk '
    {
      b = 0
      for (i = 1; i <= NF; i++) if ($i ~ /^([0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}$/) { b = i; break }
      if (b == 0) next
      ssid = ""
      for (i = 1; i < b; i++) ssid = ssid (i > 1 ? " " : "") $i
      rssi = $(b + 1)
      ch = $(b + 2)
      sub(/,.*/, "", ch)
      sec = ""
      for (i = b + 5; i <= NF; i++) sec = sec (i > b + 5 ? " " : "") $i
      if (ssid == "") ssid = "<tersembunyi>"
      printf "%s\t%s\t%s\t%s\n", ssid, rssi, ch, sec
    }'
}

build_payload() {
  local rows="$1" current_json="$2"
  local first=1
  printf '{"id":"%s","location":"%s","source":"%s","wifi":{"current":%s,"nearby":[' \
    "$(json_escape "$ID")" "$(json_escape "$NAME")" "$(json_escape "$OS-agent")" "$current_json"

  while IFS=$'\t' read -r ssid sig freq sec; do
    [ -z "${ssid:-}" ] && continue
    if [ "$OS" = "Darwin" ]; then
      # macOS: kolom kedua adalah RSSI, ketiga channel, keempat keamanan.
      local rssi="$sig" ch="$freq" band=""
      local pct
      pct=$(pct_from_rssi "$rssi")
      if [ -n "$ch" ] && [ "$ch" -le 14 ] 2>/dev/null; then band="2.4 GHz"; elif [ -n "$ch" ]; then band="5 GHz"; fi
      [ $first -eq 1 ] || printf ','
      first=0
      printf '{"ssid":"%s","signal":%s,"channel":%s,"band":"%s","security":"%s"}' \
        "$(json_escape "$ssid")" "$pct" "${ch:-null}" "$band" "$(security_from "$sec")"
    else
      local band ch
      band=$(band_from_freq "$freq")
      ch=$(channel_from_freq "$freq")
      [ $first -eq 1 ] || printf ','
      first=0
      printf '{"ssid":"%s","signal":%s,"channel":%s,"band":"%s","security":"%s"}' \
        "$(json_escape "$ssid")" "${sig:-0}" "${ch:-null}" "$band" "$(security_from "$sec")"
    fi
  done <<< "$rows"

  printf ']},"clients":[],"network":{}}'
}

current_json_linux() {
  local line ssid sig freq
  line=$(nmcli -t -f ACTIVE,SIGNAL,FREQ,SSID device wifi list 2>/dev/null | awk -F: '$1=="yes"' | head -n 1)
  if [ -z "$line" ]; then printf 'null'; return; fi
  sig="${line%%:*}"; rest="${line#*:}"
  freq="${rest%%:*}"; rest="${rest#*:}"
  freq="${freq%% *}"
  ssid="${rest#*:}"
  ssid=$(printf '%s' "$ssid" | sed 's/\\:/:/g; s/\\\\/\\/g')
  printf '{"ssid":"%s","signal":%s,"channel":%s,"band":"%s"}' \
    "$(json_escape "$ssid")" "${sig:-0}" "$(channel_from_freq "$freq")" "$(band_from_freq "$freq")"
}

current_json_macos() {
  local airport="/System/Library/PrivateFrameworks/Apple80211.framework/Versions/Current/Resources/airport"
  [ -x "$airport" ] || { printf 'null'; return; }
  local info ssid rssi ch band
  info=$("$airport" -I 2>/dev/null)
  ssid=$(printf '%s\n' "$info" | awk -F': ' '/^ *SSID:/{print $2; exit}')
  rssi=$(printf '%s\n' "$info" | awk -F': ' '/agrCtlRSSI:/{print $2; exit}')
  ch=$(printf '%s\n' "$info" | awk -F': ' '/channel:/{print $2; exit}' | awk -F, '{print $1}')
  if [ -z "$ssid" ]; then printf 'null'; return; fi
  band=""
  if [ -n "$ch" ]; then
    if [ "$ch" -le 14 ] 2>/dev/null; then band="2.4 GHz"; else band="5 GHz"; fi
  fi
  printf '{"ssid":"%s","signal":%s,"channel":%s,"band":"%s"}' \
    "$(json_escape "$ssid")" "$(pct_from_rssi "${rssi:--100}")" "${ch:-null}" "$band"
}

echo ""
echo "  NetWatch Agent ($OS)"
echo "  Server : $SERVER"
echo "  Lokasi : $NAME"
echo "  ID     : $ID"
echo ""
echo "  Tekan Ctrl+C untuk berhenti."
echo ""

while true; do
  if [ "$OS" = "Darwin" ]; then
    ROWS=$(scan_macos) || { echo "Perintah 'airport' tidak tersedia di macOS ini."; exit 1; }
    CURRENT=$(current_json_macos)
  else
    ROWS=$(scan_linux)
    CURRENT=$(current_json_linux)
  fi

  if [ -z "$ROWS" ]; then
    echo "[$(date +%H:%M:%S)] tidak ada jaringan terdeteksi (cek izin/NetworkManager)"
  else
    PAYLOAD=$(build_payload "$ROWS" "$CURRENT")
    if curl -sS -m 25 -X POST "$SERVER/api/agent/ingest" \
        -H "x-agent-key: $KEY" \
        -H 'Content-Type: application/json; charset=utf-8' \
        --data-binary "$PAYLOAD" >/dev/null; then
      COUNT=$(printf '%s\n' "$ROWS" | grep -c . )
      echo "[$(date +%H:%M:%S)] terkirim: $COUNT jaringan"
    else
      echo "[$(date +%H:%M:%S)] gagal mengirim"
    fi
  fi

  sleep "$INTERVAL"
done

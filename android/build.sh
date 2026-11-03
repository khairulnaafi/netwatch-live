#!/usr/bin/env bash
# Build APK NetWatch Agent tanpa Gradle (aapt2 + javac + d8 + apksigner).
#
# Pakai di Windows + Git Bash:
#   bash android/build.sh
#
# Hasil: agent/netwatch.apk
set -euo pipefail

cd "$(dirname "$0")"

SDK="${ANDROID_SDK:-$(cygpath -u "${LOCALAPPDATA:-$HOME/AppData/Local}")/Android/Sdk}"
JAVA_HOME="${JAVA_HOME:-/c/Program Files/Android/Android Studio/jbr}"
export JAVA_HOME
BUILD_TOOLS="${BUILD_TOOLS:-36.0.0}"
PLATFORM="${PLATFORM:-android-34}"
MIN_SDK=24
TARGET_SDK=34
VERSION_CODE="${VERSION_CODE:-2}"
VERSION_NAME="${VERSION_NAME:-1.1}"

BT="$SDK/build-tools/$BUILD_TOOLS"
ANDROID_JAR="$SDK/platforms/$PLATFORM/android.jar"

fail() { printf '  [GAGAL] %s\n' "$*" >&2; exit 1; }

[ -x "$BT/aapt2.exe" ] || [ -x "$BT/aapt2" ] || fail "aapt2 tidak ada di $BT"
[ -f "$ANDROID_JAR" ] || fail "android.jar tidak ada di $ANDROID_JAR"
[ -x "$JAVA_HOME/bin/javac.exe" ] || fail "javac tidak ada di $JAVA_HOME"

AAPT2="$BT/aapt2.exe"; [ -x "$AAPT2" ] || AAPT2="$BT/aapt2"
D8="$BT/d8.bat"; [ -f "$D8" ] || D8="$BT/d8"
ZIPALIGN="$BT/zipalign.exe"; [ -x "$ZIPALIGN" ] || ZIPALIGN="$BT/zipalign"
APKSIGNER="$BT/apksigner.bat"; [ -f "$APKSIGNER" ] || APKSIGNER="$BT/apksigner"
JAVAC="$JAVA_HOME/bin/javac.exe"; [ -x "$JAVAC" ] || JAVAC="$JAVA_HOME/bin/javac"
KEYTOOL="$JAVA_HOME/bin/keytool.exe"; [ -x "$KEYTOOL" ] || KEYTOOL="$JAVA_HOME/bin/keytool"

OUT="$(cd .. && pwd)/agent/netwatch.apk"
# Keystore disimpan di luar build/ supaya tidak ikut terhapus. Kalau berubah,
# pengguna tidak bisa memperbarui APK tanpa menghapus aplikasi lama.
KEYSTORE="${KEYSTORE:-netwatch.jks}"
rm -rf build
mkdir -p build/classes build/dex build/gen

printf '  1/6  kompilasi resource\n'
"$AAPT2" compile --dir res -o build/res.zip

printf '  2/6  menghubungkan manifest + resource\n'
"$AAPT2" link \
  -o build/base.apk \
  -I "$ANDROID_JAR" \
  --manifest AndroidManifest.xml \
  -R build/res.zip \
  --java build/gen \
  --min-sdk-version "$MIN_SDK" \
  --target-sdk-version "$TARGET_SDK" \
  --version-code "$VERSION_CODE" \
  --version-name "$VERSION_NAME"

printf '  3/6  kompilasi Java\n'
"$JAVAC" -encoding UTF-8 --release 8 -nowarn \
  -classpath "$ANDROID_JAR" \
  -d build/classes \
  $(find src build/gen -name '*.java')

printf '  4/6  dex (d8)\n'
"$D8" --release --lib "$ANDROID_JAR" --min-api "$MIN_SDK" \
  --output build/dex \
  $(find build/classes -name '*.class')

printf '  5/6  paket + zipalign\n'
cp build/base.apk build/unsigned.apk
(cd build/dex && "$JAVA_HOME/bin/jar.exe" uf ../unsigned.apk classes.dex)
"$ZIPALIGN" -p -f 4 build/unsigned.apk build/aligned.apk

printf '  6/6  tanda tangan\n'
if [ ! -f "$KEYSTORE" ]; then
  "$KEYTOOL" -genkeypair -keystore "$KEYSTORE" -alias netwatch \
    -keyalg RSA -keysize 2048 -validity 10000 \
    -storepass netwatch -keypass netwatch \
    -dname "CN=NetWatch Agent, O=NetWatch, C=ID" >/dev/null 2>&1
fi
"$APKSIGNER" sign \
  --ks "$KEYSTORE" --ks-pass pass:netwatch --key-pass pass:netwatch \
  --out "$OUT" build/aligned.apk

"$APKSIGNER" verify --print-certs "$OUT" | sed -n '1,3p' || true
printf '\n  APK siap: %s (%s byte)\n' "$OUT" "$(stat -c %s "$OUT")"

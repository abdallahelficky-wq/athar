#!/usr/bin/env bash
# بناء APK أندرويد والتحقق منه — مشترك بين android-build.yml (نقطة البيع) وandroid-station-build.yml
# (عامل المحطة). الاستخدام:
#   android-signed-build.sh <مجلد المشروع> <applicationId المتوقَّع> <اسم ملف الإخراج>
#
# - أسرار التوقيع موجودة (ANDROID_KEYSTORE_BASE64 + كلمات المرور + الاسم المستعار): يبني
#   assembleRelease موقَّعاً بالمفتاح الدائم، ويرفض الشهادة لو كانت شهادة debug.
# - غير موجودة: يبني assembleDebug مع تحذير ظاهر، ويُعلِن signed=false فترفض مهمة النشر إصداره.
# في الحالتين: aapt2 يتحقق من applicationId وversionName، وapksigner يطبع بصمة شهادة التوقيع.
set -euo pipefail

project_dir="$1"
expected_package="$2"
output_name="$3"

cd "$project_dir"
chmod +x gradlew
build_tools="$(ls -d "$ANDROID_HOME"/build-tools/*/ | sort -V | tail -1)"

keystore=""
if [ -n "${ANDROID_KEYSTORE_BASE64:-}" ]; then
  keystore="$RUNNER_TEMP/release.jks"
  printf '%s' "$ANDROID_KEYSTORE_BASE64" | base64 -d > "$keystore"
  trap 'rm -f "$keystore"' EXIT
  export ANDROID_KEYSTORE_FILE="$keystore"
  ./gradlew assembleRelease --stacktrace
  apk="app/build/outputs/apk/release/app-release.apk"
  signed=true
else
  echo "::warning::Release signing secrets are not configured — building a DEBUG APK. It will not be published."
  ./gradlew assembleDebug --stacktrace
  apk="app/build/outputs/apk/debug/app-debug.apk"
  signed=false
fi

cp "$apk" "$output_name"

badging="$("$build_tools/aapt2" dump badging "$output_name")"
echo "$badging" | grep -E "^(package|application-label|application):"
expected_version="$(grep -oP 'versionName = "\K[^"]+' app/build.gradle.kts)"
echo "$badging" | grep -q "^package: name='${expected_package}' " || { echo "::error::applicationId is not ${expected_package}"; exit 1; }
echo "$badging" | grep -q "versionName='${expected_version}'" || { echo "::error::versionName is not ${expected_version}"; exit 1; }

certs="$("$build_tools/apksigner" verify --print-certs "$output_name")"
echo "$certs" | grep -E "Signer #1 certificate (DN|SHA-256 digest)"
if [ "$signed" = true ] && echo "$certs" | grep -q "CN=Android Debug"; then
  echo "::error::signed with a debug certificate, not the release key"
  exit 1
fi

sha256sum "$output_name"
echo "signed=${signed}" >> "$GITHUB_OUTPUT"
echo "apk=${project_dir}/${output_name}" >> "$GITHUB_OUTPUT"

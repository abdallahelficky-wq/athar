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

# خطأ ظاهر في السجل نفسه أيضاً — أسطر ::error:: تُحوَّل إلى تنبيهات ولا تظهر في سجل الخطوة الخام
fail() { echo "ERROR: $*"; echo "::error::$*"; exit 1; }

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
grep -E "^(package|application-label|application):" <<<"$badging"
expected_version="$(grep -oP 'versionName = "\K[^"]+' app/build.gradle.kts)"
# here-strings لا أنابيب: مع pipefail، "echo | grep -q" قد يفشل بـSIGPIPE حين يخرج grep عند أول تطابق
grep -q "^package: name='${expected_package}' " <<<"$badging" || fail "applicationId is not ${expected_package}"
grep -q "versionName='${expected_version}'" <<<"$badging" || fail "versionName is not ${expected_version}"

# الإخراج الكامل لـapksigner يُطبَع كما هو (لا أسرار فيه: شهادة عامة وبصماتها فقط)
certs="$("$build_tools/apksigner" verify --verbose --print-certs "$output_name" 2>&1)" || { echo "$certs"; fail "apksigner verification failed"; }
echo "$certs"
cert_sha256="$(grep -i -m1 -E 'certificate SHA-256 digest' <<<"$certs" | sed -E 's/.*digest: *//' || true)"
[ -n "$cert_sha256" ] || fail "could not read the signing certificate SHA-256 from apksigner"
echo "Signing certificate SHA-256: ${cert_sha256}"
if [ "$signed" = true ] && grep -q "CN=Android Debug" <<<"$certs"; then
  fail "signed with a debug certificate, not the release key"
fi

sha256sum "$output_name"
echo "signed=${signed}" >> "$GITHUB_OUTPUT"
echo "cert_sha256=${cert_sha256}" >> "$GITHUB_OUTPUT"
echo "apk=${project_dir}/${output_name}" >> "$GITHUB_OUTPUT"

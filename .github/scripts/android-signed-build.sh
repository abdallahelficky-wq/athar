#!/usr/bin/env bash
# بناء APK أندرويد والتحقق منه — مشترك بين android-build.yml (نقطة البيع) وandroid-station-build.yml
# (عامل المحطة). الاستخدام:
#   android-signed-build.sh <debug|release> <مجلد المشروع> <applicationId المتوقَّع> <اسم ملف الإخراج>
#
# - debug: كل دفعة وكل PR — assembleDebug بلا أي سر (مهام البناء العادية لا تستلم أسرار التوقيع إطلاقاً).
# - release: مهمة release اليدوية فقط، داخل بيئة GitHub "android-release" (مقصورة على فرع production
#   وتنتظر موافقة المراجِع). يفشل إن نقص أي من القيم الأربع، ولا يرجع أبداً إلى debug بصمت، ويرفض
#   الشهادة لو كانت شهادة debug.
# في الحالتين: aapt2 يتحقق من applicationId وversionName، وapksigner يطبع بصمة شهادة التوقيع.
#
# لا set -x هنا ولا في أي خطوة تستدعيه: التتبّع يطبع القيم الموسَّعة ويتجاوز إخفاء GitHub للأسرار.
set -euo pipefail

# خطأ ظاهر في السجل نفسه أيضاً — أسطر ::error:: تُحوَّل إلى تنبيهات ولا تظهر في سجل الخطوة الخام
fail() { echo "ERROR: $*"; echo "::error::$*"; exit 1; }

mode="$1"
project_dir="$2"
expected_package="$3"
output_name="$4"

cd "$project_dir"
chmod +x gradlew
build_tools="$(ls -d "$ANDROID_HOME"/build-tools/*/ | sort -V | tail -1)"

case "$mode" in
  release)
    # أسماء القيم الناقصة فقط — لا تُطبَع أي قيمة
    for name in ANDROID_KEYSTORE_BASE64 ANDROID_KEYSTORE_PASSWORD ANDROID_KEY_ALIAS ANDROID_KEY_PASSWORD; do
      [ -n "${!name:-}" ] || fail "${name} is empty — register it in the android-release environment. Not building."
    done

    # الحذف مُسجَّل قبل كتابة أي بايت: فشل base64 -d في منتصف الكتابة لا يترك ملفاً جزئياً. INT/TERM
    # (إلغاء المهمة) تمرّ عبر exit فيعمل فخ EXIT نفسه. القتل القسري (SIGKILL) يتخطّى أي فخ — لذلك
    # خطوة تنظيف if: always() في ملف العمل، ثم RUNNER_TEMP الذي يفرغه GitHub بعد كل مهمة.
    keystore="$RUNNER_TEMP/release.jks"
    trap 'rm -f "$keystore"' EXIT
    trap 'exit 130' INT
    trap 'exit 143' TERM
    # printf أمر داخلي في bash: السر لا يظهر في سطر أوامر أي عملية. الملف مقروء للمالك فقط.
    ( umask 077; printf '%s' "$ANDROID_KEYSTORE_BASE64" | base64 -d > "$keystore" )
    export ANDROID_KEYSTORE_FILE="$keystore"

    # --no-daemon: لا تبقى عملية Gradle تحمل كلمات المرور في بيئتها بعد انتهاء هذه الخطوة
    ./gradlew assembleRelease --no-daemon --stacktrace
    apk="app/build/outputs/apk/release/app-release.apk"
    signed=true
    ;;
  debug)
    ./gradlew assembleDebug --stacktrace
    apk="app/build/outputs/apk/debug/app-debug.apk"
    signed=false
    ;;
  *)
    fail "mode must be debug or release, got '${mode}'"
    ;;
esac

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

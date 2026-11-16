# Tism Pro Store — Android app

تطبيق العملاء لمتجر تيسم برو: غلاف WebView حول المتجر الإلكتروني العام الذي يُخدَم من أثر
(`frontend/src/store`، الرابط في `app/build.gradle.kts` → `STORE_URL`). لا منطق أعمال في التطبيق؛ أي
تغيير في المتجر يظهر فيه فوراً بلا إصدار جديد.

- يبقى داخل التطبيق كل ما تحت مسار المتجر؛ واتساب والاتصال وأي رابط خارجي تُفتَح في تطبيقاتها.
- السلة ورمز دخول العميل في `localStorage` فيبقيان بين مرات الفتح.
- صلاحية واحدة: الإنترنت. بلا جسر JavaScript.
- الأيقونة الحالية مؤقتة (ثقب مفتاح أصفر على أسود) — تُستبدَل بشعار Tism Pro في
  `app/src/main/res/drawable/ic_launcher_foreground.xml`.

البناء والتوقيع عبر `.github/workflows/android-store-build.yml` بالسكربت المشترك
`.github/scripts/android-signed-build.sh`: APK debug في كل دفعة تلمس `android-store/`، وإصدار موقَّع يدوياً
من بيئة `android-release`.

لمتجر شركة أخرى: غيّر `STORE_URL` و`applicationId`/`namespace` واسم التطبيق والأيقونة.

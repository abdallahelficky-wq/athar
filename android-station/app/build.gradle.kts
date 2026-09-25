plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.athar.station"
    compileSdk = 34

    defaultConfig {
        // مختلف عن تطبيق نقطة البيع (com.athar.pos) عمداً — يُثبَّت التطبيقان جنباً إلى جنب بدل أن يستبدل
        // أحدهما الآخر.
        applicationId = "com.athar.station"
        minSdk = 24
        targetSdk = 34
        versionCode = 2
        versionName = "1.1"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }

    // توقيع إصدار دائم (release) — مفتاح واحد ثابت لكل الإصدارات حتى يُثبَّت أي تحديث فوق النسخة
    // السابقة على الجهاز. المفتاح لا يُحفَظ في المستودع إطلاقاً: يُمرَّر فقط عبر متغيرات بيئة تضبطها
    // مهمة release في CI من بيئة GitHub "android-release". بدونها يخرج assembleRelease غير موقَّع — لا
    // يُوقَّع أبداً بمفتاح debug مؤقت بصمت.
    val releaseKeystore = System.getenv("ANDROID_KEYSTORE_FILE")
    signingConfigs {
        if (releaseKeystore != null) {
            create("release") {
                storeFile = file(releaseKeystore)
                storePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("ANDROID_KEY_ALIAS")
                keyPassword = System.getenv("ANDROID_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            if (releaseKeystore != null) signingConfig = signingConfigs.getByName("release")
        }
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.activity:activity-ktx:1.9.3")

    // اختبار الكاميرا الفعلي على محاكي في CI (app/src/androidTest) — راجع README.md
    androidTestImplementation("androidx.test:core-ktx:1.6.1")
    androidTestImplementation("androidx.test:runner:1.6.2")
    androidTestImplementation("androidx.test:rules:1.6.1")
    androidTestImplementation("androidx.test.ext:junit-ktx:1.2.1")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.6.1")
    androidTestImplementation("androidx.test.espresso:espresso-intents:3.6.1")
    androidTestImplementation("androidx.test.uiautomator:uiautomator:2.3.0")
}

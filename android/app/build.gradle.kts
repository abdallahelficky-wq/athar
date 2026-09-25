plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.athar.pos"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.athar.pos"
        minSdk = 24
        targetSdk = 34
        versionCode = 3
        versionName = "1.2"
    }

    buildFeatures {
        viewBinding = false
        // مطلوبة صراحةً — التطبيق يعتمد على ملفي AIDL (IWoyouService/ICallback) لتوليد أصناف
        // Stub التي يبنيها bindService عليها فعلياً (راجع MainActivity.kt).
        aidl = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }

    // توقيع إصدار دائم (release) — مفتاح واحد ثابت لكل الإصدارات حتى يُثبَّت أي تحديث فوق النسخة
    // السابقة على الجهاز. المفتاح لا يُحفَظ في المستودع إطلاقاً: يُمرَّر فقط عبر متغيرات بيئة يضبطها CI
    // من أسرار GitHub (ANDROID_KEYSTORE_*). بدونها يخرج assembleRelease غير موقَّع — لا يُوقَّع أبداً
    // بمفتاح debug مؤقت بصمت.
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
}

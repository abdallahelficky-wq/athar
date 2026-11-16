plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "sa.tismpro.store"
    compileSdk = 34

    defaultConfig {
        applicationId = "sa.tismpro.store"
        // 26+: الأيقونة تكيّفية بطبقات متجهة فقط (بلا صور PNG قديمة لكل كثافة)
        minSdk = 26
        targetSdk = 34
        versionCode = 1
        versionName = "1.0"
        // رابط المتجر العام الذي يفتحه التطبيق — ثابت وقت البناء (لا شاشة إعدادات: تطبيق للعملاء)
        buildConfigField("String", "STORE_URL", "\"https://atharerp.com/store/tism-pro\"")
    }

    buildFeatures {
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }

    // توقيع الإصدار — نفس أسلوب android/ و android-station/: المفتاح لا يُحفَظ في المستودع، ويُمرَّر فقط
    // عبر متغيرات بيئة تضبطها مهمة release في CI. بدونها يخرج assembleRelease غير موقَّع.
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

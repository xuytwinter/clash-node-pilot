plugins {
    id("com.android.application")
}

val releaseStorePath = System.getenv("ANDROID_KEYSTORE_PATH")
val hasReleaseSigning = !releaseStorePath.isNullOrBlank()

android {
    namespace = "com.clashnodepilot.companion"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.clashnodepilot.companion"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0-preview"
    }

    signingConfigs {
        if (hasReleaseSigning) {
            create("releaseFromEnv") {
                storeFile = file(releaseStorePath!!)
                storePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("ANDROID_KEY_ALIAS")
                keyPassword = System.getenv("ANDROID_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            if (hasReleaseSigning) signingConfig = signingConfigs.getByName("releaseFromEnv")
        }
        debug {
            applicationIdSuffix = ".debug"
        }
    }
}

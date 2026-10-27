buildscript {
    repositories {
        google()
        mavenCentral()
    }
    dependencies {
        classpath("com.android.tools.build:gradle:8.11.0")
        classpath("org.jetbrains.kotlin:kotlin-gradle-plugin:1.9.25")
    }
}

allprojects {
    repositories {
        google()
        mavenCentral()
        // GeckoView (Google sign-in, see GoogleOAuthActivity.kt)
        maven("https://maven.mozilla.org/maven2/")
    }
}

tasks.register("clean").configure {
    delete("build")
}


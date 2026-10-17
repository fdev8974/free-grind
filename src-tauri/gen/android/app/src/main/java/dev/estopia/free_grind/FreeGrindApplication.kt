package dev.estopia.free_grind

import android.app.Application
import android.os.Build
import java.io.File

class FreeGrindApplication : Application() {
    // The reCAPTCHA SDK keys its tokens to the app's package name, so the
    // ":recaptcha" process (RecaptchaMintActivity) poses as Grindr, as the
    // former standalone helper app did. Every other process keeps ours.
    private val isRecaptchaProcess by lazy {
        currentProcessName()?.endsWith(RecaptchaMintActivity.PROCESS_SUFFIX) == true
    }

    override fun getPackageName(): String =
        if (isRecaptchaProcess) RecaptchaMintActivity.GRINDR_PACKAGE else super.getPackageName()

    override fun onCreate() {
        super.onCreate()
        if (isRecaptchaProcess) return
        PushFirebase.initialize(this)
    }

    private fun currentProcessName(): String? =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            Application.getProcessName()
        } else {
            try {
                File("/proc/self/cmdline").readText().substringBefore('\u0000').trim()
            } catch (e: Exception) {
                null
            }
        }
}

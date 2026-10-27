package dev.estopia.free_grind

import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle

/**
 * Mints a reCAPTCHA token for one of Grindr's actions and hands it back via
 * startActivityForResult (see MainActivity.JsBridge.mintRecaptchaToken).
 *
 * Runs in its own ":recaptcha" process, where FreeGrindApplication poses as
 * Grindr towards the reCAPTCHA SDK, so the main process (WebView, FCM)
 * keeps its real identity. Not exported: only Free Grind itself can start it.
 */
class RecaptchaMintActivity : Activity() {

  companion object {
    const val PROCESS_SUFFIX = ":recaptcha"
    const val GRINDR_PACKAGE = "com.grindrapp.android"

    const val EXTRA_ACTION = "dev.estopia.free_grind.recaptcha.extra.ACTION"
    const val EXTRA_TOKEN = "dev.estopia.free_grind.recaptcha.extra.TOKEN"
    const val EXTRA_ERROR = "dev.estopia.free_grind.recaptcha.extra.ERROR"
    const val EXTRA_ERROR_DETAIL = "dev.estopia.free_grind.recaptcha.extra.ERROR_DETAIL"

    /** The action strings Grindr scores a token against. */
    private val GRINDR_ACTIONS = setOf(
      "sign_up",
      "login",
      "forgot_password",
      "report",
      "decision_appeal",
      "device_key_registration",
    )
  }

  private var resultDelivered = false

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    val action = intent.getStringExtra(EXTRA_ACTION)
    when {
      action == null || action !in GRINDR_ACTIONS -> refuse("unsupported-action")
      !isGrindrInstalled() -> refuse("grindr-missing")
      else -> RecaptchaMint.mint(application, action)
        .addOnSuccessListener { token -> deliver(RESULT_OK, Intent().putExtra(EXTRA_TOKEN, token)) }
        .addOnFailureListener { error -> refuse("mint-failed", RecaptchaMint.failureDetail(error)) }
    }
  }

  private fun refuse(error: String, detail: String? = null) {
    val data = Intent().putExtra(EXTRA_ERROR, error)
    detail?.let { data.putExtra(EXTRA_ERROR_DETAIL, it) }
    deliver(RESULT_CANCELED, data)
  }

  private fun deliver(resultCode: Int, data: Intent) {
    if (resultDelivered || isFinishing || isDestroyed) return
    resultDelivered = true
    setResult(resultCode, data)
    finish()
  }

  private fun isGrindrInstalled(): Boolean = try {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      packageManager.getPackageInfo(GRINDR_PACKAGE, PackageManager.PackageInfoFlags.of(0))
    } else {
      @Suppress("DEPRECATION")
      packageManager.getPackageInfo(GRINDR_PACKAGE, 0)
    }
    true
  } catch (e: PackageManager.NameNotFoundException) {
    false
  }
}

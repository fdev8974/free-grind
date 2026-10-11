package dev.estopia.free_grind

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager

/**
 * The Free Grind reCAPTCHA helper (fork of Open Grind's recaptcha-helper).
 * A separate app because it bundles Google's proprietary reCAPTCHA
 * Enterprise SDK and poses as the Grindr app towards it; it mints a token for
 * one of Grindr's reCAPTCHA actions and hands it back via
 * startActivityForResult.
 *
 * Only trusted when signed with the same key as this build, the same rule as
 * for the Google OAuth app (see GoogleOAuthApp.kt). The helper in turn only
 * answers Free Grind builds with a pinned certificate.
 */
object RecaptchaHelper {
  const val PACKAGE = "dev.estopia.free_grind.recaptcha"
  const val ACTION_MINT_TOKEN = "$PACKAGE.action.MINT_TOKEN"
  const val EXTRA_ACTION = "$PACKAGE.extra.ACTION"
  const val EXTRA_TOKEN = "$PACKAGE.extra.TOKEN"
  const val EXTRA_ERROR = "$PACKAGE.extra.ERROR"
  const val EXTRA_ERROR_DETAIL = "$PACKAGE.extra.ERROR_DETAIL"

  enum class Availability(val wire: String) {
    AVAILABLE("available"),
    NOT_INSTALLED("addonUnavailable"),
    UNTRUSTED("addonUntrusted"),
  }

  fun availability(context: Context): Availability {
    val installed = try {
      context.packageManager.getPackageInfo(PACKAGE, 0)
      true
    } catch (e: PackageManager.NameNotFoundException) {
      false
    }
    if (!installed) return Availability.NOT_INSTALLED
    val sameSigner = try {
      context.packageManager.checkSignatures(context.packageName, PACKAGE) ==
        PackageManager.SIGNATURE_MATCH
    } catch (e: Exception) {
      false
    }
    return if (sameSigner) Availability.AVAILABLE else Availability.UNTRUSTED
  }

  fun mintIntent(action: String): Intent =
    Intent(ACTION_MINT_TOKEN).setPackage(PACKAGE).putExtra(EXTRA_ACTION, action)
}

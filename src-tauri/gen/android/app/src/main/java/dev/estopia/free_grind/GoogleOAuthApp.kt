package dev.estopia.free_grind

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager

/**
 * The Free Grind Google OAuth companion app (fork of Open Grind's
 * google-oauth-app). It hands a Google OAuth token back to us in two ways:
 *  - we ask for one via [requestTokenIntent] (startActivityForResult), or
 *  - it was opened from the launcher and pushes the token into
 *    TokenHandoffActivity once the user finished signing in.
 *
 * Both directions are only trusted when the companion is signed with the
 * same key as this build, so a third-party app reusing the package name or
 * action can neither feed us a token nor be asked for one.
 */
object GoogleOAuthApp {
  const val PACKAGE = "dev.estopia.free_grind.google_oauth"
  const val ACTION_REQUEST_TOKEN = "$PACKAGE.action.REQUEST_TOKEN"
  const val EXTRA_TOKEN = "$PACKAGE.extra.TOKEN"

  fun isTrusted(context: Context, packageName: String?): Boolean {
    if (packageName != PACKAGE) return false
    return try {
      context.packageManager.checkSignatures(context.packageName, PACKAGE) ==
        PackageManager.SIGNATURE_MATCH
    } catch (e: Exception) {
      false
    }
  }

  fun requestTokenIntent(): Intent =
    Intent(ACTION_REQUEST_TOKEN).setPackage(PACKAGE)
}

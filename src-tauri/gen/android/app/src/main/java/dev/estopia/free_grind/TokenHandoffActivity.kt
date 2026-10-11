package dev.estopia.free_grind

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.util.Log

/**
 * Receives a Google OAuth token from the companion app when it was opened on
 * its own (not via JsBridge.requestGoogleToken). The companion starts this
 * with startActivityForResult, so callingPackage identifies it; anything not
 * signed like us is refused with RESULT_CANCELED, and the companion then
 * shows the token for copying instead.
 */
class TokenHandoffActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    val token = intent.getStringExtra(GoogleOAuthApp.EXTRA_TOKEN)?.trim().orEmpty()
    if (!GoogleOAuthApp.isTrusted(this, callingPackage) || token.isEmpty()) {
      Log.w("GoogleOAuth", "Refused token handoff from $callingPackage")
      setResult(RESULT_CANCELED)
      finish()
      return
    }
    MainActivity.deliverGoogleToken(token)
    startActivity(
      Intent(this, MainActivity::class.java)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
    )
    setResult(RESULT_OK)
    finish()
  }
}

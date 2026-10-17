package dev.estopia.free_grind

import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.util.Log
import android.widget.FrameLayout
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import org.json.JSONObject
import org.mozilla.geckoview.AllowOrDeny
import org.mozilla.geckoview.GeckoResult
import org.mozilla.geckoview.GeckoRuntime
import org.mozilla.geckoview.GeckoRuntimeSettings
import org.mozilla.geckoview.GeckoSession
import org.mozilla.geckoview.GeckoSessionSettings
import org.mozilla.geckoview.GeckoView
import org.mozilla.geckoview.StorageController
import org.mozilla.geckoview.WebExtension

/**
 * "Sign in with Google" on Android (ported from the former Free Grind Google
 * OAuth companion app). Google Identity Services refuses the Android System
 * WebView and only accepts Grindr's origin, so this loads web.grindr.com in
 * a private GeckoView session with the Free Grind Google OAuth WebExtension
 * built in (assets/grindr-google-oauth, bundled from
 * src-tauri/vendor/freegrind-google-oauth-webextension by build.gradle.kts).
 * The extension hands the access token over native messaging; it goes back
 * to MainActivity as the activity result ([EXTRA_TOKEN]).
 *
 * Runs in its own ":google_oauth" process so Gecko never shares one with
 * the app's WebView. Not exported: only Free Grind itself can start it.
 */
class GoogleOAuthActivity : ComponentActivity() {

  companion object {
    const val EXTRA_TOKEN = "dev.estopia.free_grind.google_oauth.extra.TOKEN"

    private const val TAG = "GoogleOAuth"
    private const val HELPER_URL = "https://web.grindr.com/"
    private const val NATIVE_APP = "grindr_google_oauth"
    private const val EXTENSION_ID = "freegrind-google-oauth-webextension@estopia.dev"
    private const val EXTENSION_URL = "resource://android/assets/grindr-google-oauth/"
  }

  private lateinit var runtime: GeckoRuntime
  private lateinit var geckoView: GeckoView
  private lateinit var session: GeckoSession
  private var popupSession: GeckoSession? = null
  private var extension: WebExtension? = null

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge(
      statusBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
      navigationBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
    )
    super.onCreate(savedInstanceState)

    geckoView = GeckoView(this)
    val root = FrameLayout(this).apply {
      setBackgroundColor(Color.BLACK)
      addView(geckoView, FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT)
    }
    setContentView(root)
    ViewCompat.setOnApplyWindowInsetsListener(root) { v, insets ->
      val bars = insets.getInsets(
        WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
      )
      v.setPadding(bars.left, bars.top, bars.right, bars.bottom)
      insets
    }
    geckoView.coverUntilFirstPaint(Color.BLACK)

    runtime = GeckoRuntime.getDefault(this)
    runtime.settings.preferredColorScheme = GeckoRuntimeSettings.COLOR_SCHEME_DARK

    session = GeckoSession(privateSessionSettings()).apply {
      navigationDelegate = newSessionDelegate
      promptDelegate = popupPromptDelegate
    }
    session.open(runtime)
    geckoView.setSession(session)

    // The extension's delegate must be registered before the page loads:
    // GeckoView queues messages sent while none is.
    runtime.webExtensionController
      .ensureBuiltIn(EXTENSION_URL, EXTENSION_ID)
      .then<WebExtension> { installed ->
        extension = installed
        bindMessageDelegate()
        runtime.webExtensionController.setAllowedInPrivateBrowsing(installed!!, true)
      }
      .accept({
        session.loadUri(HELPER_URL)
      }, { e ->
        Log.e(TAG, "extension install failed", e)
        finish()
      })
  }

  // One delegate per runtime and native app name, and the last registration
  // wins, so take it back whenever this activity is in front again.
  override fun onResume() {
    super.onResume()
    bindMessageDelegate()
  }

  private fun bindMessageDelegate() {
    extension?.setMessageDelegate(messageDelegate, NATIVE_APP)
  }

  override fun onDestroy() {
    if (::session.isInitialized) {
      popupSession?.close()
      session.close()
      runtime.storageController.clearData(StorageController.ClearFlags.ALL)
    }
    super.onDestroy()
  }

  private fun privateSessionSettings() =
    GeckoSessionSettings.Builder().usePrivateMode(true).build()

  // Answer within 10s and with a primitive, see the extension's README.
  private val messageDelegate = object : WebExtension.MessageDelegate {
    override fun onMessage(
      nativeApp: String,
      message: Any,
      sender: WebExtension.MessageSender,
    ): GeckoResult<Any> {
      val msg = message as? JSONObject ?: return refuse("message is not an object")
      return when (msg.optString("type")) {
        "token" -> {
          val token = msg.optString("token").trim()
          if (token.isEmpty()) return refuse("empty token")
          setResult(RESULT_OK, Intent().putExtra(EXTRA_TOKEN, token))
          finish()
          GeckoResult.fromValue(true)
        }
        // The page already shows the reason and offers to try again.
        "error" -> {
          Log.e(TAG, "extension error: ${msg.optString("error")}")
          GeckoResult.fromValue(true)
        }
        else -> refuse("unknown message type")
      }
    }
  }

  private fun refuse(reason: String): GeckoResult<Any> =
    GeckoResult.fromException(IllegalArgumentException(reason))

  // GIS opens Google's sign-in as a popup window.
  private val popupPromptDelegate = object : GeckoSession.PromptDelegate {
    override fun onPopupPrompt(
      session: GeckoSession,
      prompt: GeckoSession.PromptDelegate.PopupPrompt,
    ): GeckoResult<GeckoSession.PromptDelegate.PromptResponse> =
      GeckoResult.fromValue(prompt.confirm(AllowOrDeny.ALLOW))
  }

  private val newSessionDelegate = object : GeckoSession.NavigationDelegate {
    override fun onNewSession(session: GeckoSession, uri: String): GeckoResult<GeckoSession> {
      val popup = GeckoSession(privateSessionSettings())
      popupSession = popup
      popup.contentDelegate = object : GeckoSession.ContentDelegate {
        override fun onCloseRequest(session: GeckoSession) = closePopup()
      }
      geckoView.setSession(popup)
      return GeckoResult.fromValue(popup)
    }
  }

  private fun closePopup() {
    geckoView.setSession(session)
    popupSession?.close()
    popupSession = null
  }
}

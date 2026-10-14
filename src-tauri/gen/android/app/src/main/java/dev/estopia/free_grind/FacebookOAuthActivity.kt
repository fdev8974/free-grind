package dev.estopia.free_grind

import android.os.Bundle
import android.os.Process
import android.util.Log
import android.view.View
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.webkit.ProfileStore
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import java.lang.ref.WeakReference

private const val ISOLATED_PROFILE = "facebook-oauth"
private const val TAG = "FacebookOAuth"

private fun isolatedProfileSupported() =
  WebViewFeature.isFeatureSupported(WebViewFeature.MULTI_PROFILE)

/**
 * Hosts the "Sign in with Facebook" webview window that the Rust side opens
 * (see api/facebook_oauth/web.rs, `activity_name("FacebookOAuthActivity")`).
 * The WebView runs in its own profile so Facebook's cookies never mix with
 * the app's, and the profile is wiped on every launch and on sign-out.
 *
 * Adapted from Open Grind (MIT, https://git.opengrind.org/open-grind/open-grind).
 */
class FacebookOAuthActivity : TauriActivity() {

  override fun onCreate(savedInstanceState: Bundle?) {
    // Restored after process death: the Rust flow that opened this window is
    // gone, so there is nothing to sign in to. Start over at MainActivity.
    if (savedInstanceState != null && !signInStartedInProcess) {
      finish()
      Process.killProcess(Process.myPid())
      return
    }
    signInStartedInProcess = true
    enableEdgeToEdge()
    if (isolatedProfileSupported()) {
      clearIsolatedProfile()
    } else {
      Log.w(TAG, "MULTI_PROFILE unsupported: sign-in shares the app cookie jar")
    }
    super.onCreate(savedInstanceState)
    live = WeakReference(this)
    val content = findViewById<View>(android.R.id.content)
    ViewCompat.setOnApplyWindowInsetsListener(content) { view, insets ->
      val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
      val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
      view.setPadding(bars.left, bars.top, bars.right, maxOf(bars.bottom, ime.bottom))
      WindowInsetsCompat.CONSUMED
    }
  }

  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    webView.settings.setGeolocationEnabled(false)
    if (isolatedProfileSupported()) {
      runCatching {
        WebViewCompat.setProfile(webView, ISOLATED_PROFILE)
      }.onFailure { Log.w(TAG, "sign-in profile isolation failed", it) }
    }
    ViewCompat.requestApplyInsets(webView)
  }

  override fun onDestroy() {
    if (live?.get() === this) {
      live = null
    }
    super.onDestroy()
  }

  companion object {
    @Volatile
    private var live: WeakReference<FacebookOAuthActivity>? = null

    private var signInStartedInProcess = false

    fun clearIsolatedProfile() {
      if (!isolatedProfileSupported()) return
      runCatching {
        val profile = ProfileStore.getInstance().getOrCreateProfile(ISOLATED_PROFILE)
        profile.cookieManager.removeAllCookies(null)
        profile.webStorage.deleteAllData()
      }.onFailure { Log.w(TAG, "isolated sign-in profile not cleared", it) }
    }

    fun dismiss() {
      val activity = live?.get() ?: return
      activity.runOnUiThread {
        if (!activity.isFinishing && !activity.isDestroyed) {
          activity.finish()
        }
      }
    }
  }
}

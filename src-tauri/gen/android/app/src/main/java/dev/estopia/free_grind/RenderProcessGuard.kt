package dev.estopia.free_grind

import android.app.ActivityManager
import android.content.ComponentCallbacks2
import android.content.Context
import android.graphics.Bitmap
import android.os.Build
import android.os.SystemClock
import android.util.Log
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import org.json.JSONObject

/**
 * Records why the WebView's renderer process died (out of memory vs. crash)
 * together with the route, memory state and the frontend's crash context, so
 * the report can be shown on the next start (`takeRenderCrashReport`).
 *
 * Without this, a dead renderer just takes the whole app down: wry's
 * generated RustWebViewClient doesn't override onRenderProcessGone. That
 * class is final and regenerated on every build, so it's wrapped here
 * instead, forwarding every callback it overrides.
 */
object RenderProcessGuard {
  private const val TAG = "RenderProcessGuard"
  private const val PREFS = "render_process_guard"
  private const val KEY_REPORT = "last_report"

  private val startedAt = SystemClock.elapsedRealtime()
  @Volatile private var lastTrimLevel: Int? = null
  @Volatile private var lastTrimAt: Long = 0
  /** Free-form key/values from the frontend (`FreeGrindBridge.setCrashContext`). */
  private val crashContext = mutableMapOf<String, String>()

  fun install(webView: WebView) {
    val current = webView.webViewClient
    if (current is GuardedClient) return
    webView.webViewClient = GuardedClient(current)
  }

  fun recordTrim(level: Int) {
    lastTrimLevel = level
    lastTrimAt = SystemClock.elapsedRealtime()
  }

  fun setContext(key: String, value: String?) {
    synchronized(crashContext) {
      if (value.isNullOrEmpty()) crashContext.remove(key) else crashContext[key] = value
    }
  }

  /** Returns the last stored report (JSON) once and clears it. */
  fun takeReport(context: Context): String? {
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val report = prefs.getString(KEY_REPORT, null) ?: return null
    prefs.edit().remove(KEY_REPORT).apply()
    return report
  }

  private fun buildReport(context: Context, detail: RenderProcessGoneDetail): JSONObject {
    val now = SystemClock.elapsedRealtime()
    val report = JSONObject()
    report.put("timestamp", System.currentTimeMillis())
    // false = the system killed the renderer to reclaim memory.
    report.put("didCrash", detail.didCrash())
    report.put("rendererPriorityAtExit", priorityName(detail.rendererPriorityAtExit()))
    report.put("route", MainActivity.activeRoute ?: "")
    report.put("foreground", MainActivity.inForeground)
    report.put("uptimeSec", (now - startedAt) / 1000)

    val activityManager = context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
    val memory = ActivityManager.MemoryInfo().also { activityManager.getMemoryInfo(it) }
    report.put("memory", JSONObject().apply {
      put("availMb", memory.availMem / MB)
      put("totalMb", memory.totalMem / MB)
      put("thresholdMb", memory.threshold / MB)
      put("lowMemory", memory.lowMemory)
      put("memoryClassMb", activityManager.memoryClass)
      put("largeMemoryClassMb", activityManager.largeMemoryClass)
      put("lowRamDevice", activityManager.isLowRamDevice)
    })
    lastTrimLevel?.let { level ->
      report.put("lastTrim", JSONObject().apply {
        put("level", trimName(level))
        put("secondsAgo", (now - lastTrimAt) / 1000)
      })
    }

    report.put("device", JSONObject().apply {
      put("manufacturer", Build.MANUFACTURER)
      put("model", Build.MODEL)
      put("sdk", Build.VERSION.SDK_INT)
      put("webView", WebView.getCurrentWebViewPackage()?.versionName ?: "")
      put("app", runCatching {
        context.packageManager.getPackageInfo(context.packageName, 0).versionName
      }.getOrNull() ?: "")
      val metrics = context.resources.displayMetrics
      put("screen", "${metrics.widthPixels}x${metrics.heightPixels}@${metrics.density}")
    })

    synchronized(crashContext) {
      if (crashContext.isNotEmpty()) report.put("context", JSONObject(crashContext.toMap()))
    }
    return report
  }

  private fun priorityName(priority: Int): String = when (priority) {
    WebView.RENDERER_PRIORITY_WAIVED -> "waived"
    WebView.RENDERER_PRIORITY_BOUND -> "bound"
    WebView.RENDERER_PRIORITY_IMPORTANT -> "important"
    else -> priority.toString()
  }

  @Suppress("DEPRECATION")
  private fun trimName(level: Int): String = when (level) {
    ComponentCallbacks2.TRIM_MEMORY_RUNNING_MODERATE -> "running_moderate"
    ComponentCallbacks2.TRIM_MEMORY_RUNNING_LOW -> "running_low"
    ComponentCallbacks2.TRIM_MEMORY_RUNNING_CRITICAL -> "running_critical"
    ComponentCallbacks2.TRIM_MEMORY_UI_HIDDEN -> "ui_hidden"
    ComponentCallbacks2.TRIM_MEMORY_BACKGROUND -> "background"
    ComponentCallbacks2.TRIM_MEMORY_MODERATE -> "moderate"
    ComponentCallbacks2.TRIM_MEMORY_COMPLETE -> "complete"
    else -> level.toString()
  }

  private const val MB = 1024L * 1024L

  private class GuardedClient(private val inner: WebViewClient) : WebViewClient() {
    override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
      inner.shouldInterceptRequest(view, request)

    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
      inner.shouldOverrideUrlLoading(view, request)

    override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) =
      inner.onPageStarted(view, url, favicon)

    override fun onPageFinished(view: WebView, url: String) =
      inner.onPageFinished(view, url)

    override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) =
      inner.onReceivedError(view, request, error)

    override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
      try {
        val report = buildReport(view.context, detail)
        Log.e(TAG, "WebView renderer gone: $report")
        // commit(), not apply(): the process is about to die.
        view.context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
          .edit().putString(KEY_REPORT, report.toString()).commit()
      } catch (t: Throwable) {
        Log.e(TAG, "Failed to record renderer death", t)
      }
      // Unhandled, as before: the system then ends the app, which restarts
      // cleanly. Recovering in place would need wry to rebuild its WebView.
      return false
    }
  }
}

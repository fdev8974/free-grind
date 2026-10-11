package dev.estopia.free_grind

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageInstaller
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.util.Log
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.atomic.AtomicBoolean

/**
 * In-app APK self-update, modelled on Open Grind's UpdatePlugin/ApkInstaller:
 * download the release APK into cacheDir, verify it's really a newer build of
 * *this* app signed with *our* key, then hand it to a PackageInstaller
 * session. Android shows its own "Update this app?" confirmation; the
 * outcome comes back through [ApkUpdateResultReceiver].
 *
 * Progress/outcome is reported through [emit] as `fg:apk-update` window
 * events with a `state` of downloading | verifying | needs-permission |
 * installing | installed | error (+ `code`).
 */
object ApkUpdater {
  private const val TAG = "ApkUpdater"
  private const val DIR = "apk-update"
  private const val FILE = "free-grind-update.apk"
  private const val ALLOWED_PREFIX = "https://github.com/fdev8974/free-grind/releases/download/"
  private const val BUFFER = 1 shl 16

  private val busy = AtomicBoolean(false)

  @Volatile
  var emit: (JSONObject) -> Unit = {}

  private fun event(state: String, extra: JSONObject.() -> Unit = {}) {
    emit(JSONObject().put("state", state).apply(extra))
  }

  private fun error(code: String, message: String? = null) {
    Log.w(TAG, "update failed: $code ${message ?: ""}")
    event("error") {
      put("code", code)
      if (message != null) put("message", message)
    }
  }

  private fun apkFile(context: Context): File = File(File(context.cacheDir, DIR), FILE)

  /** Drops a leftover APK from an earlier (finished or abandoned) update — they're 150MB+. */
  fun cleanupStale(context: Context) {
    if (busy.get()) return
    runCatching { File(context.cacheDir, DIR).deleteRecursively() }
  }

  fun canInstallNow(context: Context): Boolean =
    Build.VERSION.SDK_INT < Build.VERSION_CODES.O || context.packageManager.canRequestPackageInstalls()

  fun openInstallPermissionSettings(context: Context): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return false
    return runCatching {
      context.startActivity(
        Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${context.packageName}"))
          .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
      )
    }.isSuccess
  }

  /** Returns false when [url] isn't one of our GitHub release assets or an update is already running. */
  fun downloadAndInstall(context: Context, url: String): Boolean {
    if (!url.startsWith(ALLOWED_PREFIX) || !url.endsWith(".apk")) return false
    if (!busy.compareAndSet(false, true)) return false
    val appContext = context.applicationContext
    Thread({
      try {
        val apk = download(appContext, url)
        if (apk != null && verify(appContext, apk)) installVerified(appContext, apk)
      } catch (t: Throwable) {
        error("failed", t.message)
      } finally {
        busy.set(false)
      }
    }, "free-grind-apk-update").start()
    return true
  }

  /** Retries the install of an already downloaded APK, e.g. after granting "install unknown apps". */
  fun installDownloaded(context: Context): Boolean {
    val apk = apkFile(context)
    if (!apk.isFile) return false
    if (!busy.compareAndSet(false, true)) return false
    val appContext = context.applicationContext
    Thread({
      try {
        if (verify(appContext, apk)) installVerified(appContext, apk)
      } catch (t: Throwable) {
        error("failed", t.message)
      } finally {
        busy.set(false)
      }
    }, "free-grind-apk-install").start()
    return true
  }

  private fun download(context: Context, url: String): File? {
    val target = apkFile(context)
    target.parentFile?.deleteRecursively()
    target.parentFile?.mkdirs()
    val partial = File(target.parentFile, "$FILE.part")

    val connection = (URL(url).openConnection() as HttpURLConnection).apply {
      instanceFollowRedirects = true
      connectTimeout = 20_000
      readTimeout = 30_000
      setRequestProperty("Accept", "application/octet-stream")
    }
    try {
      val status = connection.responseCode
      if (status !in 200..299) {
        error("http", "HTTP $status")
        return null
      }
      val total = connection.contentLengthLong
      var received = 0L
      var lastPercent = -1
      event("downloading") {
        put("received", 0)
        put("total", total)
      }
      connection.inputStream.use { input ->
        partial.outputStream().use { output ->
          val buffer = ByteArray(BUFFER)
          while (true) {
            val read = input.read(buffer)
            if (read < 0) break
            output.write(buffer, 0, read)
            received += read
            val percent = if (total > 0) ((received * 100) / total).toInt() else -1
            if (percent != lastPercent) {
              lastPercent = percent
              event("downloading") {
                put("received", received)
                put("total", total)
              }
            }
          }
        }
      }
      if (total > 0 && received != total) {
        partial.delete()
        error("incomplete")
        return null
      }
      if (!partial.renameTo(target)) {
        error("failed", "rename")
        return null
      }
      return target
    } catch (t: Throwable) {
      partial.delete()
      error("network", t.message)
      return null
    } finally {
      connection.disconnect()
    }
  }

  @Suppress("DEPRECATION")
  private fun archiveInfo(pm: PackageManager, apk: File): PackageInfo? {
    val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      PackageManager.GET_SIGNING_CERTIFICATES
    } else {
      PackageManager.GET_SIGNATURES
    }
    return pm.getPackageArchiveInfo(apk.path, flags)
  }

  @Suppress("DEPRECATION")
  private fun installedInfo(pm: PackageManager, packageName: String): PackageInfo {
    val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      PackageManager.GET_SIGNING_CERTIFICATES
    } else {
      PackageManager.GET_SIGNATURES
    }
    return pm.getPackageInfo(packageName, flags)
  }

  @Suppress("DEPRECATION")
  private fun signerDigests(info: PackageInfo): Set<String> {
    val signatures = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      val signing = info.signingInfo ?: return emptySet()
      if (signing.hasMultipleSigners()) signing.apkContentsSigners else signing.signingCertificateHistory
    } else {
      info.signatures
    } ?: return emptySet()
    val sha = MessageDigest.getInstance("SHA-256")
    return signatures.map { sig -> sha.digest(sig.toByteArray()).joinToString("") { "%02x".format(it) } }.toSet()
  }

  @Suppress("DEPRECATION")
  private fun versionCodeOf(info: PackageInfo): Long =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) info.longVersionCode else info.versionCode.toLong()

  private fun verify(context: Context, apk: File): Boolean {
    event("verifying")
    val pm = context.packageManager
    val archive = archiveInfo(pm, apk)
    if (archive == null) {
      error("unreadable")
      return false
    }
    if (archive.packageName != context.packageName) {
      error("package-mismatch", archive.packageName)
      return false
    }
    val installed = installedInfo(pm, context.packageName)
    val ours = signerDigests(installed)
    val theirs = signerDigests(archive)
    // Android would refuse a foreign signer too, but only after the user
    // confirmed — fail early with a clear reason (e.g. a debug build).
    if (ours.isEmpty() || theirs.isEmpty() || ours.intersect(theirs).isEmpty()) {
      error("foreign-signer")
      return false
    }
    if (versionCodeOf(archive) < versionCodeOf(installed)) {
      error("downgrade")
      return false
    }
    return true
  }

  private fun installVerified(context: Context, apk: File) {
    if (!canInstallNow(context)) {
      event("needs-permission")
      return
    }
    event("installing")
    val installer = context.packageManager.packageInstaller
    installer.mySessions.forEach { runCatching { installer.abandonSession(it.sessionId) } }

    val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL).apply {
      setAppPackageName(context.packageName)
      setSize(apk.length())
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        setInstallReason(PackageManager.INSTALL_REASON_USER)
      }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
      }
    }
    val sessionId = installer.createSession(params)
    try {
      installer.openSession(sessionId).use { session ->
        session.openWrite("base.apk", 0, apk.length()).use { output ->
          apk.inputStream().use { input -> input.copyTo(output, BUFFER) }
          session.fsync(output)
        }
        // targetSdk 31+ needs an explicit mutability flag; the installer fills in extras.
        var flags = PendingIntent.FLAG_UPDATE_CURRENT
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) flags = flags or PendingIntent.FLAG_MUTABLE
        val intent = Intent(context, ApkUpdateResultReceiver::class.java)
        val sender = PendingIntent.getBroadcast(context, sessionId, intent, flags).intentSender
        session.commit(sender)
      }
    } catch (t: Throwable) {
      runCatching { installer.abandonSession(sessionId) }
      throw t
    }
  }

  internal fun onInstallStatus(context: Context, intent: Intent) {
    val status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)
    val message = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE)
    when (status) {
      PackageInstaller.STATUS_PENDING_USER_ACTION -> {
        val confirm = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
          intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent::class.java)
        } else {
          @Suppress("DEPRECATION")
          intent.getParcelableExtra<Intent>(Intent.EXTRA_INTENT)
        }
        if (confirm == null) {
          error("failed", "missing confirmation intent")
          return
        }
        runCatching { context.startActivity(confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
          .onFailure { error("failed", it.message) }
      }
      // Usually never seen: a successful self-update kills this process.
      PackageInstaller.STATUS_SUCCESS -> {
        cleanupStale(context)
        event("installed")
      }
      PackageInstaller.STATUS_FAILURE_ABORTED -> error("canceled")
      PackageInstaller.STATUS_FAILURE_CONFLICT -> error("conflict", message)
      PackageInstaller.STATUS_FAILURE_INCOMPATIBLE -> error("incompatible", message)
      PackageInstaller.STATUS_FAILURE_STORAGE -> error("storage", message)
      PackageInstaller.STATUS_FAILURE_BLOCKED -> error("blocked", message)
      else -> error("failed", message)
    }
  }
}

class ApkUpdateResultReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    ApkUpdater.onInstallStatus(context, intent)
  }
}

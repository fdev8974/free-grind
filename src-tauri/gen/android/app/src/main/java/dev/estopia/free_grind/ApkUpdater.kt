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
 * In-app APK installs, modelled on Open Grind's UpdatePlugin/ApkInstaller:
 * download a release APK into cacheDir, verify it's the expected package
 * signed with *our* key, then hand it to a PackageInstaller session. Android
 * shows its own install/update confirmation; the outcome comes back through
 * [ApkUpdateResultReceiver].
 *
 * Progress/outcome is reported through [emit] as `fg:apk-update` window
 * events with a `target` (see [Target.key]) and a `state` of downloading |
 * verifying | needs-permission | installing | installed | error (+ `code`).
 */
object ApkUpdater {
  private const val TAG = "ApkUpdater"
  private const val DIR = "apk-update"
  private const val BUFFER = 1 shl 16
  private const val EXTRA_TARGET = "dev.estopia.free_grind.extra.APK_TARGET"

  enum class Target(
    val key: String,
    val fileName: String,
    val allowedPrefix: String,
  ) {
    SELF(
      "app",
      "free-grind-update.apk",
      "https://github.com/fdev8974/free-grind/releases/download/",
    );

    fun packageName(context: Context): String = when (this) {
      SELF -> context.packageName
    }

    companion object {
      fun of(key: String?): Target? = values().firstOrNull { it.key == key }
    }
  }

  private val busy = AtomicBoolean(false)

  @Volatile
  var emit: (JSONObject) -> Unit = {}

  private fun event(target: Target, state: String, extra: JSONObject.() -> Unit = {}) {
    emit(JSONObject().put("target", target.key).put("state", state).apply(extra))
  }

  private fun error(target: Target, code: String, message: String? = null) {
    Log.w(TAG, "${target.key} install failed: $code ${message ?: ""}")
    event(target, "error") {
      put("code", code)
      if (message != null) put("message", message)
    }
  }

  private fun apkFile(context: Context, target: Target): File =
    File(File(File(context.cacheDir, DIR), target.key), target.fileName)

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

  /** Returns false when [url] isn't one of our GitHub release assets or an install is already running. */
  fun downloadAndInstall(context: Context, url: String): Boolean {
    if (!url.startsWith(Target.SELF.allowedPrefix) || !url.endsWith(".apk")) return false
    return downloadAndInstall(context, Target.SELF) { url }
  }

  private fun downloadAndInstall(context: Context, target: Target, resolveUrl: (Target) -> String): Boolean {
    if (!busy.compareAndSet(false, true)) return false
    val appContext = context.applicationContext
    Thread({
      try {
        val url = resolveUrl(target)
        if (!url.startsWith(target.allowedPrefix) || !url.endsWith(".apk")) {
          error(target, "untrusted-url", url)
        } else {
          val apk = download(appContext, target, url)
          if (apk != null && verify(appContext, target, apk)) installVerified(appContext, target, apk)
        }
      } catch (t: Throwable) {
        error(target, "failed", t.message)
      } finally {
        busy.set(false)
      }
    }, "free-grind-apk-${target.key}").start()
    return true
  }

  /** Retries the install of an already downloaded APK, e.g. after granting "install unknown apps". */
  fun installDownloaded(context: Context, target: Target = Target.SELF): Boolean {
    val apk = apkFile(context, target)
    if (!apk.isFile) return false
    if (!busy.compareAndSet(false, true)) return false
    val appContext = context.applicationContext
    Thread({
      try {
        if (verify(appContext, target, apk)) installVerified(appContext, target, apk)
      } catch (t: Throwable) {
        error(target, "failed", t.message)
      } finally {
        busy.set(false)
      }
    }, "free-grind-apk-install-${target.key}").start()
    return true
  }

  private fun download(context: Context, target: Target, url: String): File? {
    val file = apkFile(context, target)
    file.parentFile?.deleteRecursively()
    file.parentFile?.mkdirs()
    val partial = File(file.parentFile, "${target.fileName}.part")

    val connection = (URL(url).openConnection() as HttpURLConnection).apply {
      instanceFollowRedirects = true
      connectTimeout = 20_000
      readTimeout = 30_000
      setRequestProperty("Accept", "application/octet-stream")
    }
    try {
      val status = connection.responseCode
      if (status !in 200..299) {
        error(target, "http", "HTTP $status")
        return null
      }
      val total = connection.contentLengthLong
      var received = 0L
      var lastPercent = -1
      event(target, "downloading") {
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
              event(target, "downloading") {
                put("received", received)
                put("total", total)
              }
            }
          }
        }
      }
      if (total > 0 && received != total) {
        partial.delete()
        error(target, "incomplete")
        return null
      }
      if (!partial.renameTo(file)) {
        error(target, "failed", "rename")
        return null
      }
      return file
    } catch (t: Throwable) {
      partial.delete()
      error(target, "network", t.message)
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
  private fun installedInfo(pm: PackageManager, packageName: String): PackageInfo? {
    val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      PackageManager.GET_SIGNING_CERTIFICATES
    } else {
      PackageManager.GET_SIGNATURES
    }
    return try {
      pm.getPackageInfo(packageName, flags)
    } catch (e: PackageManager.NameNotFoundException) {
      null
    }
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

  private fun verify(context: Context, target: Target, apk: File): Boolean {
    event(target, "verifying")
    val pm = context.packageManager
    val archive = archiveInfo(pm, apk)
    if (archive == null) {
      error(target, "unreadable")
      return false
    }
    val expectedPackage = target.packageName(context)
    if (archive.packageName != expectedPackage) {
      error(target, "package-mismatch", archive.packageName)
      return false
    }
    // The self-update is signed with this build's key by definition.
    val ours = installedInfo(pm, context.packageName)?.let(::signerDigests).orEmpty()
    val theirs = signerDigests(archive)
    // Android would refuse a foreign signer on update too, but only after the
    // user confirmed — fail early with a clear reason (e.g. a debug build).
    if (ours.isEmpty() || theirs.isEmpty() || ours.intersect(theirs).isEmpty()) {
      error(target, "foreign-signer")
      return false
    }
    val installed = installedInfo(pm, expectedPackage)
    if (installed != null && versionCodeOf(archive) < versionCodeOf(installed)) {
      error(target, "downgrade")
      return false
    }
    return true
  }

  private fun installVerified(context: Context, target: Target, apk: File) {
    if (!canInstallNow(context)) {
      event(target, "needs-permission")
      return
    }
    event(target, "installing")
    val installer = context.packageManager.packageInstaller
    installer.mySessions.forEach { runCatching { installer.abandonSession(it.sessionId) } }

    val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL).apply {
      setAppPackageName(target.packageName(context))
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
        val intent = Intent(context, ApkUpdateResultReceiver::class.java).putExtra(EXTRA_TARGET, target.key)
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
    val target = Target.of(intent.getStringExtra(EXTRA_TARGET)) ?: Target.SELF
    when (status) {
      PackageInstaller.STATUS_PENDING_USER_ACTION -> {
        val confirm = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
          intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent::class.java)
        } else {
          @Suppress("DEPRECATION")
          intent.getParcelableExtra<Intent>(Intent.EXTRA_INTENT)
        }
        if (confirm == null) {
          error(target, "failed", "missing confirmation intent")
          return
        }
        runCatching { context.startActivity(confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
          .onFailure { error(target, "failed", it.message) }
      }
      // Never seen for a self-update, which kills this process.
      PackageInstaller.STATUS_SUCCESS -> {
        cleanupStale(context)
        event(target, "installed")
      }
      PackageInstaller.STATUS_FAILURE_ABORTED -> error(target, "canceled")
      PackageInstaller.STATUS_FAILURE_CONFLICT -> error(target, "conflict", message)
      PackageInstaller.STATUS_FAILURE_INCOMPATIBLE -> error(target, "incompatible", message)
      PackageInstaller.STATUS_FAILURE_STORAGE -> error(target, "storage", message)
      PackageInstaller.STATUS_FAILURE_BLOCKED -> error(target, "blocked", message)
      else -> error(target, "failed", message)
    }
  }
}

class ApkUpdateResultReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    ApkUpdater.onInstallStatus(context, intent)
  }
}

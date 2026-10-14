package dev.estopia.free_grind

import android.app.Application
import android.content.Context
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager

/**
 * Presents Grindr's package identity to Firebase so FCM hands out tokens for
 * Grindr's sender — but only on the identity/registration path.
 *
 * The delivery path (FcmBroadcastProcessor / WithinAppServiceConnection)
 * must see our real package name, otherwise it targets the MESSAGING_EVENT
 * intent at com.grindrapp.android and pushes are delayed or dropped. Matches
 * open-grind/fcm-service@9decdce.
 */
class SpoofedContext(base: Context) : Application() {
    init {
        attachBaseContext(base)
    }

    private val spoofedPackageManager by lazy {
        SpoofedPackageManager(
            baseContext.packageManager,
            baseContext.packageName,
            getString(R.string.grindr_cert),
        )
    }

    override fun getApplicationContext(): Context = this

    override fun getPackageName(): String =
        if (calledByFirebaseIdentity()) SpoofedPackageManager.GRINDR_PACKAGE else baseContext.packageName

    override fun getApplicationInfo(): ApplicationInfo =
        super.getApplicationInfo().also {
            if (calledByFirebaseIdentity()) it.packageName = SpoofedPackageManager.GRINDR_PACKAGE
        }

    override fun getPackageManager(): PackageManager = spoofedPackageManager

    private fun calledByFirebaseIdentity(): Boolean {
        val stack = Thread.currentThread().stackTrace
        if (stack.any { it.className.contains("FcmBroadcastProcessor") || it.className.contains("WithinAppServiceConnection") }) {
            return false
        }
        return stack.any {
            it.className.contains("FirebaseInstallationServiceClient") ||
                it.className.contains("com.google.firebase.messaging.Metadata") ||
                it.className.contains("FirebaseMessaging")
        }
    }
}

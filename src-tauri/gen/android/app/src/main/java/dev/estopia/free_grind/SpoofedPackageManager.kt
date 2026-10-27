package dev.estopia.free_grind

import android.content.pm.ApplicationInfo
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.content.pm.Signature

class SpoofedPackageManager(
    base: PackageManager,
    private val basePackageName: String,
    private val grindrCertHex: String,
) : AbstractSpoofedPackageManager(base) {

    @Suppress("DEPRECATION")
    override fun getPackageInfo(p0: String, p1: Int): PackageInfo {
        if (p0 != GRINDR_PACKAGE) return base.getPackageInfo(p0, p1)
        return base.getPackageInfo(basePackageName, p1).apply {
            packageName = GRINDR_PACKAGE
            signatures = arrayOf(Signature(decodeHex(grindrCertHex)))
        }
    }

    override fun getApplicationInfo(p0: String, p1: Int): ApplicationInfo =
        base.getApplicationInfo(p0, p1)

    private fun decodeHex(hex: String): ByteArray {
        val cleaned = hex.filterNot(Char::isWhitespace)
        require(cleaned.length % 2 == 0) { "grindr_cert hex must have an even length" }
        return cleaned.chunked(2).map { it.toInt(16).toByte() }.toByteArray()
    }

    companion object {
        const val GRINDR_PACKAGE = "com.grindrapp.android"
    }
}

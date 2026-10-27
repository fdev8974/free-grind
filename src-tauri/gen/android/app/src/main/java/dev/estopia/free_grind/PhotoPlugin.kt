package dev.estopia.free_grind

import android.app.Activity
import android.graphics.Bitmap
import android.graphics.ColorSpace
import android.graphics.ImageDecoder
import android.os.Build
import android.util.Base64
import androidx.annotation.RequiresApi
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import kotlin.math.max
import kotlin.math.roundToInt

@InvokeArg
class DecodeToPngArgs {
    lateinit var data: String
    var maxEdge: Int = 1024
}

/**
 * Decodes photos image-rs can't read (HEIF/HEIC) into a downscaled sRGB PNG
 * for the Rust upload normalization (src-tauri/src/media/photo/heif.rs).
 * Ported from open-grind's PhotoPlugin.
 */
@TauriPlugin
class PhotoPlugin(activity: Activity) : Plugin(activity) {

    @Command
    fun decodeToPng(invoke: Invoke) {
        // ImageDecoder (and the platform's HEIF support) arrived in API 28.
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P) {
            invoke.reject(ERROR_UNDECODABLE)
            return
        }
        decode(invoke)
    }

    @RequiresApi(Build.VERSION_CODES.P)
    private fun decode(invoke: Invoke) {
        var bitmap: Bitmap? = null
        try {
            val args = invoke.parseArgs(DecodeToPngArgs::class.java)
            val encoded = Base64.decode(args.data, Base64.NO_WRAP)
            val source = ImageDecoder.createSource(ByteBuffer.wrap(encoded))

            bitmap =
                ImageDecoder.decodeBitmap(source) { decoder, info, _ ->
                    decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
                    decoder.setTargetColorSpace(ColorSpace.get(ColorSpace.Named.SRGB))
                    val longest = max(info.size.width, info.size.height)
                    if (longest > args.maxEdge) {
                        val scale = args.maxEdge.toDouble() / longest
                        decoder.setTargetSize(
                            max(1, (info.size.width * scale).roundToInt()),
                            max(1, (info.size.height * scale).roundToInt()),
                        )
                    }
                }

            val png = ByteArrayOutputStream()
            if (!bitmap.compress(Bitmap.CompressFormat.PNG, 100, png)) {
                invoke.reject(ERROR_UNDECODABLE)
                return
            }
            invoke.resolve(
                JSObject().apply {
                    put("data", Base64.encodeToString(png.toByteArray(), Base64.NO_WRAP))
                }
            )
        } catch (e: Exception) {
            invoke.reject(ERROR_UNDECODABLE)
        } catch (e: OutOfMemoryError) {
            invoke.reject(ERROR_TOO_LARGE)
        } finally {
            bitmap?.recycle()
        }
    }

    private companion object {
        const val ERROR_UNDECODABLE = "undecodable"
        const val ERROR_TOO_LARGE = "too-large"
    }
}

package dev.estopia.free_grind

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Build
import android.util.Base64
import android.util.Log
import android.webkit.MimeTypeMap
import androidx.core.app.Person
import androidx.core.content.IntentCompat
import androidx.core.content.pm.ShortcutInfoCompat
import androidx.core.content.pm.ShortcutManagerCompat
import androidx.core.graphics.drawable.IconCompat
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.util.UUID

/**
 * Android share sheet integration: receives images shared into the app
 * (ACTION_SEND / ACTION_SEND_MULTIPLE, declared on every disguise alias in
 * AndroidManifest.xml so the share sheet shows the active alias's label and
 * icon) and publishes recent chats as Direct Share targets.
 *
 * Shared images are copied into cache right away — the read grant on the
 * sender's content:// URIs only lasts as long as the receiving intent — and
 * the frontend pulls each one by id through FreeGrindBridge.takeSharedImage.
 *
 * Direct Share shortcuts show chat names and avatars in the system share
 * sheet (and the launcher's long-press menu), so they only exist while the
 * app is undisguised; any disguise clears them.
 */
object ShareTarget {
  private const val TAG = "ShareTarget"
  private const val SHARED_DIR = "shared_images"
  private const val MAX_IMAGES = 10
  // Must match the <category> in res/xml/share_targets.xml.
  private const val SHARE_CATEGORY = "dev.estopia.free_grind.category.SHARE_IMAGE"
  private const val SHORTCUT_ID_PREFIX = "chat:"

  fun isShareIntent(intent: Intent?): Boolean {
    if (intent == null) return false
    if (intent.action != Intent.ACTION_SEND && intent.action != Intent.ACTION_SEND_MULTIPLE) return false
    return intent.type?.startsWith("image/") == true
  }

  /**
   * Copies the shared images into cache and returns the payload for the
   * frontend (`{ conversationId, items: [{ id, mimeType, name }] }`), or null
   * if nothing could be read. conversationId is set when the share came
   * through one of our Direct Share shortcuts.
   */
  fun readShareIntent(context: Context, intent: Intent): JSONObject? {
    val uris = sharedUris(intent).take(MAX_IMAGES)
    val dir = File(context.cacheDir, SHARED_DIR).apply { mkdirs() }
    // Leftovers from a share the frontend never picked up.
    dir.listFiles()?.filter { System.currentTimeMillis() - it.lastModified() > 60 * 60 * 1000L }?.forEach { it.delete() }

    val items = JSONArray()
    for (uri in uris) {
      try {
        val mimeType = context.contentResolver.getType(uri)?.takeIf { it.startsWith("image/") }
          ?: intent.type?.takeIf { it.startsWith("image/") && !it.endsWith("*") }
          ?: "image/jpeg"
        val id = UUID.randomUUID().toString()
        val input = context.contentResolver.openInputStream(uri) ?: continue
        input.use { stream -> File(dir, id).outputStream().use { stream.copyTo(it) } }
        val extension = MimeTypeMap.getSingleton().getExtensionFromMimeType(mimeType) ?: "jpg"
        items.put(JSONObject().put("id", id).put("mimeType", mimeType).put("name", "shared-$id.$extension"))
      } catch (error: Exception) {
        Log.w(TAG, "Failed to read shared image $uri", error)
      }
    }
    if (items.length() == 0) return null

    val shortcutId = intent.getStringExtra(ShortcutManagerCompat.EXTRA_SHORTCUT_ID)
    val conversationId = shortcutId?.takeIf { it.startsWith(SHORTCUT_ID_PREFIX) }?.removePrefix(SHORTCUT_ID_PREFIX)
    return JSONObject()
      .put("conversationId", conversationId ?: JSONObject.NULL)
      .put("items", items)
  }

  private fun sharedUris(intent: Intent): List<Uri> {
    val uris = mutableListOf<Uri>()
    if (intent.action == Intent.ACTION_SEND_MULTIPLE) {
      IntentCompat.getParcelableArrayListExtra(intent, Intent.EXTRA_STREAM, Uri::class.java)?.let(uris::addAll)
    } else {
      IntentCompat.getParcelableExtra(intent, Intent.EXTRA_STREAM, Uri::class.java)?.let(uris::add)
    }
    // Some senders only fill ClipData.
    if (uris.isEmpty()) {
      intent.clipData?.let { clip -> for (i in 0 until clip.itemCount) clip.getItemAt(i).uri?.let(uris::add) }
    }
    return uris.distinct()
  }

  /** Base64 of a cached shared image, deleting it; null for an unknown id. */
  fun takeSharedImage(context: Context, id: String): String? {
    // Ids are UUIDs we generated — reject anything else, so this can't be
    // used to read arbitrary files out of the cache dir.
    if (runCatching { UUID.fromString(id) }.isFailure) return null
    val file = File(File(context.cacheDir, SHARED_DIR), id)
    if (!file.isFile) return null
    return try {
      Base64.encodeToString(file.readBytes(), Base64.NO_WRAP)
    } finally {
      file.delete()
    }
  }

  /**
   * Replaces the Direct Share targets with [chatsJson]
   * (`[{ conversationId, name, avatarUrl }]`, most recent first). Clears them
   * instead while a disguise is active. Does network I/O — call off the main
   * thread.
   */
  fun publishShortcuts(context: Context, chatsJson: String) {
    if (AppDisguise.currentDisguise(context) != AppDisguise.Identity.DEFAULT) {
      clearShortcuts(context)
      return
    }
    try {
      val chats = JSONArray(chatsJson)
      val limit = minOf(ShortcutManagerCompat.getMaxShortcutCountPerActivity(context), 4)
      val launcher = ComponentName(context.packageName, "${MainActivity::class.java.`package`!!.name}.DisguiseDefaultAlias")
      val shortcuts = (0 until minOf(chats.length(), limit)).mapNotNull { index ->
        val chat = chats.optJSONObject(index) ?: return@mapNotNull null
        val conversationId = NotificationPoster.normalizeNullableString(chat.optString("conversationId"))
          ?: return@mapNotNull null
        val name = NotificationPoster.normalizeSenderName(context, chat.optString("name"))
        val icon = NotificationPoster.normalizeNullableString(chat.optString("avatarUrl"))
          ?.let(::downloadAvatar)
          ?.let(IconCompat::createWithAdaptiveBitmap)
          ?: IconCompat.createWithResource(context, R.drawable.blank_profile)
        val person = Person.Builder().setName(name).setKey(conversationId).setIcon(icon).build()
        ShortcutInfoCompat.Builder(context, "$SHORTCUT_ID_PREFIX$conversationId")
          .setActivity(launcher)
          .setShortLabel(name)
          .setIcon(icon)
          .setPerson(person)
          .setLongLived(true)
          .setCategories(setOf(SHARE_CATEGORY))
          // Tapped from the launcher's long-press menu: open the chat, via
          // the same "action" extra notification taps use.
          .setIntent(
            Intent(Intent.ACTION_VIEW)
              .setComponent(launcher)
              .putExtra("action", "chat:$conversationId"),
          )
          .build()
      }
      ShortcutManagerCompat.setDynamicShortcuts(context, shortcuts)
      Log.d(TAG, "Published ${shortcuts.size} share shortcut(s)")
    } catch (error: Exception) {
      Log.w(TAG, "Failed to publish share shortcuts", error)
    }
  }

  fun clearShortcuts(context: Context) {
    try {
      val ids = ShortcutManagerCompat.getShortcuts(
        context,
        ShortcutManagerCompat.FLAG_MATCH_DYNAMIC or ShortcutManagerCompat.FLAG_MATCH_CACHED,
      ).map { it.id }
      ShortcutManagerCompat.removeAllDynamicShortcuts(context)
      // Long-lived shortcuts can outlive removal as cached ones (e.g. kept by
      // the share sheet's ranking); drop those too so no name lingers.
      if (ids.isNotEmpty() && Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        ShortcutManagerCompat.removeLongLivedShortcuts(context, ids)
      }
    } catch (error: Exception) {
      Log.w(TAG, "Failed to clear share shortcuts", error)
    }
  }

  private fun downloadAvatar(url: String): Bitmap? = try {
    val connection = URL(url).openConnection() as HttpURLConnection
    connection.connectTimeout = 3000
    connection.readTimeout = 3000
    connection.inputStream.use(BitmapFactory::decodeStream)?.let { source ->
      // Adaptive icons crop to the inner ~66%; pad so the face stays visible.
      val size = 192
      val padded = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
      val inner = (size * 0.72f).toInt()
      val offset = (size - inner) / 2f
      android.graphics.Canvas(padded).drawBitmap(
        Bitmap.createScaledBitmap(source, inner, inner, true), offset, offset, null,
      )
      padded
    }
  } catch (error: Exception) {
    Log.w(TAG, "Failed to load shortcut avatar", error)
    null
  }
}

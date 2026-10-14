package dev.estopia.free_grind

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.ContentResolver
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.media.AudioAttributes
import android.net.Uri
import android.os.Bundle
import android.service.notification.StatusBarNotification
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.Person
import androidx.core.graphics.drawable.IconCompat
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLDecoder
import java.nio.charset.StandardCharsets

/**
 * Shared notification-rendering pipeline, called from both the FCM service
 * (background/killed delivery) and the JS `FreeGrindBridge.postLocalNotification`
 * bridge (instant delivery while the WebView is in the foreground, sourced
 * from the chat WebSocket). `recentlyNotifiedKeys` dedupes between the two:
 * whichever channel posts a given conversation/tap first wins, the other is
 * suppressed within the window — so the user never sees the same message or
 * tap notified twice.
 */
object NotificationPoster {
    private const val PUBLIC_MEDIA_BASE_URL = "https://cdns.grindr.com"
    // Shared with MainActivity's notification-cancellation paths, which must
    // cancel using the same (tag, id) pair this class posts with.
    const val NOTIFICATION_INSTANCE_ID = 1
    private const val DEDUP_WINDOW_MS = 45_000L
    private const val SEEN_PUSH_IDS_MAX = 200

    // Stored on each posted notification so withdrawal pushes
    // (grindr://unsend, grindr://clear) can find what to cancel.
    private const val EXTRA_PUSH_NOTIFICATION_ID = "dev.estopia.free_grind.extra.PUSH_NOTIFICATION_ID"
    private const val EXTRA_SENDER_ID = "dev.estopia.free_grind.extra.SENDER_ID"
    // Per-line keys on each MessagingStyle.Message of a chat notification
    // (as open-grind's ConversationNotification does): the dedupe key is the
    // push's notificationId (FCM) or the messageId (realtime bridge).
    private const val EXTRA_LINE_KEY = "dev.estopia.free_grind.extra.LINE_KEY"

    // Messages kept in one conversation's notification (newest win).
    private const val CONVERSATION_LINES_MAX = 8
    private const val PREVIEW_DIR = "notification_previews"
    private const val PREVIEW_FILES_MAX = 30
    private const val SYSTEM_UI_PACKAGE = "com.android.systemui"

    // Serializes the read-active → merge → notify cycle; FCM and the JS bridge
    // (two executor threads) can post into the same conversation at once.
    private val postLock = Any()

    private data class Line(val key: String, val text: CharSequence, val timestamp: Long, val dataMimeType: String?, val dataUri: Uri?)

    private val recentlyNotifiedKeys = mutableMapOf<String, Long>()
    // Grindr has no server-side dedupe and can deliver the same push more
    // than once; its notificationId is the dedupe key.
    private val seenPushNotificationIds = object : LinkedHashMap<String, Unit>() {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, Unit>?): Boolean =
            size > SEEN_PUSH_IDS_MAX
    }
    // Caches decoded sender avatars so repeated notifications from the same
    // person don't re-download the same bitmap (keyed by CDN URL).
    private val avatarCache = android.util.LruCache<String, Bitmap>(10)
    // Separate small cache for message content previews (picture/gif/gaymoji),
    // kept apart from avatarCache since these URLs are one-off per message
    // rather than reused across many notifications from the same sender.
    private val previewCache = android.util.LruCache<String, Bitmap>(5)

    @Synchronized
    private fun shouldSuppressAsDuplicate(key: String): Boolean {
        val now = System.currentTimeMillis()
        recentlyNotifiedKeys.entries.removeAll { now - it.value >= DEDUP_WINDOW_MS }
        // Not refreshed on a hit: a sliding window would swallow every
        // follow-up as long as they keep arriving less than a window apart.
        if (recentlyNotifiedKeys.containsKey(key)) return true
        recentlyNotifiedKeys[key] = now
        return false
    }

    /** True if a push with this notificationId was already handled. */
    @Synchronized
    fun isDuplicatePush(notificationId: String): Boolean =
        seenPushNotificationIds.put(notificationId, Unit) != null

    /**
     * grindr://unsend — withdraw this push. In a multi-message chat
     * notification only its own line is removed; the card goes away once
     * no line is left.
     */
    fun withdrawPushNotification(context: Context, notificationId: String) {
        synchronized(postLock) {
            val notificationManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            var withdrawn = 0
            for (posted in notificationManager.activeNotifications) {
                if (removeLine(context, posted, notificationId)) {
                    withdrawn++
                } else if (posted.notification.extras.getString(EXTRA_PUSH_NOTIFICATION_ID) == notificationId) {
                    withdrawn++
                    notificationManager.cancel(posted.tag, posted.id)
                }
            }
            Log.d("FCM", "Withdrew $withdrawn notification(s) for notificationId=$notificationId")
        }
    }

    /**
     * A message was unsent (realtime chat.v1.message_sent with unsent=true):
     * drop its line, or — when it isn't a line we can identify, e.g. one
     * delivered by FCM and keyed by notificationId — the conversation's
     * whole notification. Same as open-grind's PushNotifier.dismissConversation.
     */
    fun withdrawConversationLine(context: Context, conversationId: String, messageId: String) {
        synchronized(postLock) {
            val notificationManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            val tag = chatNotificationTag(conversationId)
            val card = notificationManager.activeNotifications
                .firstOrNull { it.tag == tag && it.id == NOTIFICATION_INSTANCE_ID } ?: return
            if (!removeLine(context, card, messageId)) notificationManager.cancel(card.tag, card.id)
            Log.d("FCM", "Withdrew unsent message=$messageId from conversation=$conversationId")
        }
    }

    /** Re-posts [posted] without the line keyed [key], silently. False if it has no such line. */
    private fun removeLine(context: Context, posted: StatusBarNotification, key: String): Boolean {
        val style = NotificationCompat.MessagingStyle.extractMessagingStyleFromNotification(posted.notification)
            ?: return false
        val shown = linesOf(style)
        val lines = shown.filterNot { it.key == key }
        if (lines == shown) return false
        val notificationManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val peer = style.messages.firstNotNullOfOrNull { it.person }
        if (lines.isEmpty() || peer == null) {
            notificationManager.cancel(posted.tag, posted.id)
            return true
        }
        val notification = NotificationCompat.Builder(context, posted.notification)
            .setStyle(styleOf(style.user, peer, lines))
            .setWhen(lines.last().timestamp)
            .setOnlyAlertOnce(true)
            .build()
        notificationManager.notify(posted.tag, posted.id, notification)
        return true
    }

    private fun linesOf(style: NotificationCompat.MessagingStyle): List<Line> = style.messages.mapNotNull { message ->
        message.extras.getString(EXTRA_LINE_KEY)?.let { key ->
            Line(key, message.text ?: "", message.timestamp, message.dataMimeType, message.dataUri)
        }
    }

    // Same merge as open-grind's ConversationLines.append: drop keys already
    // shown, sort by time, keep the newest CONVERSATION_LINES_MAX.
    private fun appendLines(lines: List<Line>, added: Line): List<Line> {
        if (lines.any { it.key == added.key }) return lines
        return (lines + added).sortedBy { it.timestamp }.takeLast(CONVERSATION_LINES_MAX)
    }

    private fun styleOf(me: Person, peer: Person, lines: List<Line>): NotificationCompat.MessagingStyle =
        lines.fold(NotificationCompat.MessagingStyle(me).setGroupConversation(false)) { style, line ->
            style.addMessage(
                NotificationCompat.MessagingStyle.Message(line.text, line.timestamp, peer).apply {
                    extras.putString(EXTRA_LINE_KEY, line.key)
                    if (line.dataMimeType != null && line.dataUri != null) setData(line.dataMimeType, line.dataUri)
                },
            )
        }

    /** grindr://clear?conversationId= — withdraw a conversation's notification. */
    fun withdrawConversation(context: Context, conversationId: String) {
        val tag = chatNotificationTag(conversationId)
        val cancelled = cancelActive(context) { it.tag == tag }
        Log.d("FCM", "Withdrew $cancelled notification(s) for conversation=$conversationId")
    }

    /** grindr://clear?profileIds= — withdraw every notification from these senders. */
    fun withdrawSenders(context: Context, senderIds: Set<String>) {
        val cancelled = cancelActive(context) { posted ->
            posted.notification.extras.getString(EXTRA_SENDER_ID) in senderIds ||
                senderIds.any { posted.tag == "tap:$it" || posted.tag == "chat:sender:$it" }
        }
        Log.d("FCM", "Withdrew $cancelled notification(s) for senders=$senderIds")
    }

    private fun cancelActive(context: Context, matches: (StatusBarNotification) -> Boolean): Int {
        val notificationManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val targets = notificationManager.activeNotifications.filter(matches)
        targets.forEach { notificationManager.cancel(it.tag, it.id) }
        return targets.size
    }

    fun postNotification(context: Context, payload: JSONObject) {
        val title = normalizeSenderName(payload.optString("senderName"))
        val text = payload.optString("bodyText", "Sent you a message")
        val isTap = payload.optBoolean("isTap", false)
        val rawData = payload.optJSONObject("rawData")
        val conversationId = normalizeNullableString(payload.optString("conversationId"))
            ?: extractConversationId(rawData)

        val notificationKey = resolveNotificationKey(
            isTap = isTap,
            conversationId = conversationId,
            senderName = title,
            rawData = rawData,
        )

        // FCM only covers the background (like open-grind's PushReceiver):
        // while the app is visible the realtime bridge notifies instead, so
        // the two channels never deliver the same message twice.
        val fromRealtime = payload.optString("source") == "realtime"
        if (!fromRealtime && MainActivity.inForeground) {
            Log.d("FCM", "Suppressing push notification (app visible, realtime bridge covers it)")
            return
        }
        if (isTap && shouldSuppressAsDuplicate(notificationKey)) {
            Log.d("FCM", "Suppressing notification (already shown via other channel) key=$notificationKey")
            return
        }
        val timestamp = payload.optLong("sentAt", 0L).takeIf { it > 0 } ?: System.currentTimeMillis()
        val lineKey = normalizeNullableString(if (fromRealtime) payload.optString("messageId") else rawData?.optString("notificationId"))
            ?: "t:$timestamp"

        // Per-category master switch (NotificationsPage) — this kind of
        // notification is turned off entirely, foreground or not.
        val categoryEnabled = if (isTap) MainActivity.tapNotificationsEnabled else MainActivity.chatNotificationsEnabled
        if (!categoryEnabled) {
            Log.d("FCM", "Suppressing notification (category disabled)")
            return
        }

        // Suppress while foregrounded if the user turned off "Notifications
        // While App Is Open" (a general switch, not per-category) — they only
        // want FCM delivery once the app is backgrounded/closed.
        if (MainActivity.inForeground && !MainActivity.foregroundNotificationsEnabled) {
            Log.d("FCM", "Suppressing notification (foreground notifications disabled)")
            return
        }

        // Suppress when the user is already looking at the relevant screen
        // (taps tab for tap notifications; the matching conversation for chat
        // notifications). The frontend keeps MainActivity informed via the
        // FreeGrindBridge.setActiveRoute JS hook.
        val suppress = if (isTap) {
            MainActivity.isOnTapsScreen()
        } else {
            MainActivity.isOnConversation(conversationId)
        }
        if (suppress) {
            Log.d("FCM", "Suppressing notification (user on matching screen)")
            return
        }

        // _v2 suffix forces re-creation so the custom sound takes effect on existing installs.
        val channelId = if (isTap) AppDisguise.TAPS_CHANNEL_ID else AppDisguise.CHAT_CHANNEL_ID
        val channelName = AppDisguise.channelName(context, isTap)
        val notificationId = notificationKey.hashCode()

        val notificationManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

        val soundUri: Uri = Uri.parse(
            "${ContentResolver.SCHEME_ANDROID_RESOURCE}://${context.packageName}/${R.raw.free_grind_message}"
        )
        val audioAttributes = AudioAttributes.Builder()
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .setUsage(AudioAttributes.USAGE_NOTIFICATION)
            .build()
        val channel = NotificationChannel(
            channelId,
            channelName,
            NotificationManager.IMPORTANCE_HIGH
        ).apply {
            description = if (isTap) "Notifications for incoming taps" else "Notifications for new chat messages"
            setSound(soundUri, audioAttributes)
        }
        notificationManager.createNotificationChannel(channel)
        Log.d(
            "FCM",
            "Using notification channel=$channelId notificationId=$notificationId key=$notificationKey action=${if (isTap) "taps" else conversationId}",
        )

        val actionStr = payload.optString("action").ifBlank { null }

        val intent = Intent(context, MainActivity::class.java).apply {
            // Not CLEAR_TASK: that destroys and recreates the running
            // MainActivity (and Tauri's WebView) in the same process, which
            // crashes or leaves a blank app. singleTask + these flags reuse
            // the existing instance via onNewIntent instead.
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
            if (actionStr != null) {
                putExtra("action", actionStr)
            }
            putExtra("push_payload", payload.toString())
        }
        val pendingIntent: PendingIntent = PendingIntent.getActivity(
            context, notificationId, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )

        val senderAvatarBitmap = getNotificationAvatarBitmap(context, rawData)
        val previewImageUrl = payload.optString("previewImageUrl").trim().ifBlank { null }
        // Inline preview (picture/gif/gaymoji) rides on its own message line
        // via setData, so it survives later messages being appended — unlike
        // a BigPictureStyle, which could only ever show one message.
        val previewUri = loadMessagePreviewBitmap(previewImageUrl)
            ?.let { sharePreviewWithSystemUi(context, previewImageUrl!!, it) }

        val me = Person.Builder().setName("Me").build()
        val senderIcon = IconCompat.createWithBitmap(senderAvatarBitmap)
        val sender = Person.Builder()
            .setName(title)
            // Stable identity for Android's conversation ranking, as open-grind sets it.
            .setKey(normalizeNullableString(payload.optString("senderId")))
            .setIcon(senderIcon)
            .setImportant(true)
            .build()

        val builder = NotificationCompat.Builder(context, channelId)
            // Status-bar icon: monochrome stencil with transparent background only.
            .setSmallIcon(R.drawable.ic_notification_silhouette)
            .addPerson(sender)
            // Keep the badge overlay neutral and avoid OEM color plates.
            .setColor(Color.TRANSPARENT)
            .setColorized(false)
            // Notification body avatar: sender profile bitmap.
            .setLargeIcon(senderAvatarBitmap)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .setContentIntent(pendingIntent)
            .setTicker(text)
            .setSound(soundUri)
            .addExtras(Bundle().apply {
                // Chat lines carry their own key (EXTRA_LINE_KEY); a
                // card-level one would make unsend drop the whole card.
                if (isTap) putString(EXTRA_PUSH_NOTIFICATION_ID, normalizeNullableString(rawData?.optString("notificationId")))
                putString(EXTRA_SENDER_ID, normalizeNullableString(payload.optString("senderId")))
            })

        val added = Line(lineKey, text, timestamp, previewUri?.let { "image/jpeg" }, previewUri)
        synchronized(postLock) {
            // Taps stay one line per sender; chat appends to the lines the
            // conversation's notification is already showing.
            val shown = if (isTap) emptyList() else notificationManager.activeNotifications
                .firstOrNull { it.tag == notificationKey && it.id == NOTIFICATION_INSTANCE_ID }
                ?.let { NotificationCompat.MessagingStyle.extractMessagingStyleFromNotification(it.notification) }
                ?.let(::linesOf)
                .orEmpty()
            val lines = appendLines(shown, added)
            if (lines == shown) {
                Log.d("FCM", "Suppressing notification (line already shown) key=$notificationKey")
                return
            }
            val style = styleOf(me, sender, lines).setConversationTitle(if (isTap) "Taps" else null)
            builder.setStyle(style).setWhen(lines.last().timestamp)
            notificationManager.notify(notificationKey, NOTIFICATION_INSTANCE_ID, builder.build())
            Log.d("FCM", "Local notification posted successfully key=$notificationKey lines=${lines.size}")
        }
    }

    // MessagingStyle image lines are rendered by System UI, which can't read
    // a remote URL or our private files — write the bitmap to cache and grant
    // System UI read access through the existing FileProvider. Null on any
    // failure (the line then just shows its "Sent you a picture" text).
    private fun sharePreviewWithSystemUi(context: Context, url: String, bitmap: Bitmap): Uri? = try {
        val dir = java.io.File(context.cacheDir, PREVIEW_DIR).apply { mkdirs() }
        val file = java.io.File(dir, "${Integer.toHexString(url.hashCode())}.jpg")
        if (!file.exists()) {
            file.outputStream().use { bitmap.compress(Bitmap.CompressFormat.JPEG, 85, it) }
            dir.listFiles()
                ?.sortedByDescending { it.lastModified() }
                ?.drop(PREVIEW_FILES_MAX)
                ?.forEach { it.delete() }
        }
        val uri = androidx.core.content.FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
        context.grantUriPermission(SYSTEM_UI_PACKAGE, uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
        uri
    } catch (error: Exception) {
        Log.w("FCM", "Failed to share message preview with System UI", error)
        null
    }

    private fun getNotificationAvatarBitmap(context: Context, rawData: JSONObject?): Bitmap {
        val senderBitmap = loadSenderAvatarBitmap(rawData)
        if (senderBitmap != null) {
            return scaleBitmapIfNeeded(senderBitmap, 128)
        }

        val fallback = BitmapFactory.decodeResource(context.resources, R.drawable.blank_profile)
            ?: Bitmap.createBitmap(128, 128, Bitmap.Config.ARGB_8888)
        return scaleBitmapIfNeeded(makeBlackPixelsTransparent(fallback), 128)
    }

    private fun scaleBitmapIfNeeded(source: Bitmap, maxPx: Int): Bitmap {
        if (source.width <= maxPx && source.height <= maxPx) return source
        val scale = maxPx.toFloat() / maxOf(source.width, source.height)
        val w = (source.width * scale).toInt().coerceAtLeast(1)
        val h = (source.height * scale).toInt().coerceAtLeast(1)
        return Bitmap.createScaledBitmap(source, w, h, true)
    }

    private fun makeBlackPixelsTransparent(source: Bitmap): Bitmap {
        val mutable = source.copy(Bitmap.Config.ARGB_8888, true)
        val width = mutable.width
        val height = mutable.height
        val pixels = IntArray(width * height)
        mutable.getPixels(pixels, 0, width, 0, 0, width, height)
        for (i in pixels.indices) {
            val pixel = pixels[i]
            if (Color.alpha(pixel) == 0) continue
            if (Color.red(pixel) < 28 && Color.green(pixel) < 28 && Color.blue(pixel) < 28) {
                pixels[i] = Color.TRANSPARENT
            }
        }
        mutable.setPixels(pixels, 0, width, 0, 0, width, height)
        return mutable
    }

    private fun loadSenderAvatarBitmap(rawData: JSONObject?): Bitmap? {
        val avatarUrl = extractSenderAvatarUrl(rawData)
        if (avatarUrl.isNullOrBlank()) return null
        return downloadBitmap(avatarUrl, avatarCache, "sender avatar")
    }

    // Best-effort inline preview of the message's own content (picture/gif/
    // gaymoji) for the notification. Returns null on any failure (missing
    // field, network error, decode failure) — caller falls back to a plain
    // text-only notification, same as before this existed.
    fun loadMessagePreviewBitmap(previewImageUrl: String?): Bitmap? {
        if (previewImageUrl.isNullOrBlank()) return null
        return downloadBitmap(previewImageUrl, previewCache, "message preview")
    }

    private fun downloadBitmap(url: String, cache: android.util.LruCache<String, Bitmap>, label: String): Bitmap? {
        cache.get(url)?.let { return it }

        return try {
            val connection = URL(url).openConnection() as HttpURLConnection
            connection.connectTimeout = 3000
            connection.readTimeout = 3000
            connection.instanceFollowRedirects = true
            connection.doInput = true
            connection.connect()
            val bitmap = connection.inputStream.use { stream -> BitmapFactory.decodeStream(stream) }
            if (bitmap != null) cache.put(url, bitmap)
            bitmap
        } catch (error: Exception) {
            Log.w("FCM", "Failed to load $label for notification", error)
            null
        }
    }

    private fun extractSenderAvatarUrl(rawData: JSONObject?): String? {
        if (rawData == null) {
            return null
        }

        val directUrlKeys = listOf(
            "senderAvatarUrl",
            "senderProfileImageUrl",
            "profileImageUrl",
            "thumbnailUrl",
            "imageUrl",
        )
        for (key in directUrlKeys) {
            val value = rawData.optString(key).trim()
            if (value.startsWith("http://") || value.startsWith("https://")) {
                return value
            }
        }

        val hashKeys = listOf(
            "senderProfileImageMediaHash",
            "profileImageMediaHash",
            "profileMediaHash",
            "imageHash",
            "photoHash",
            "mediaHash",
        )
        for (key in hashKeys) {
            val value = rawData.optString(key).trim()
            if (isMediaHash(value)) {
                return "$PUBLIC_MEDIA_BASE_URL/images/thumb/320x320/$value"
            }
        }

        val messageRaw = rawData.optString("message").trim()
        if (messageRaw.isNotEmpty()) {
            try {
                val messageJson = JSONObject(messageRaw)
                val senderObject = messageJson.optJSONObject("sender")
                if (senderObject != null) {
                    for (key in directUrlKeys) {
                        val value = senderObject.optString(key).trim()
                        if (value.startsWith("http://") || value.startsWith("https://")) {
                            return value
                        }
                    }
                    for (key in hashKeys) {
                        val value = senderObject.optString(key).trim()
                        if (isMediaHash(value)) {
                            return "$PUBLIC_MEDIA_BASE_URL/images/thumb/320x320/$value"
                        }
                    }
                }
            } catch (_: Exception) {
                // Ignore malformed JSON and keep default notification icon.
            }
        }

        return null
    }

    // Mirrors the field-probing done client-side in chatUtils.ts's
    // getMessageImageUrl/getGaymojiUrl — the server payload shape is
    // inconsistent across message types, so several possible field names are
    // tried before giving up. `messageBody` is the message JSON's own `body`
    // object (not `rawData` — this is about the message's content, not the
    // sender's avatar). Returns null (no preview, falls back to text-only)
    // for any type not listed here, notably ExpiringImage and Video.
    fun extractMessagePreviewImageUrl(messageBody: JSONObject?, type: String?): String? {
        if (messageBody == null) return null

        return when (type) {
            "Image" -> extractBodyMediaUrl(messageBody)
            "Giphy" -> extractGiphyPreviewUrl(messageBody)
            "Gaymoji" -> extractGaymojiPreviewUrl(messageBody)
            else -> null
        }
    }

    private fun extractBodyMediaUrl(body: JSONObject): String? {
        val directUrlKeys = listOf(
            "url", "imageUrl", "mediaUrl", "previewUrl", "thumbUrl", "signedUrl", "cdnUrl", "urlPath",
        )
        for (key in directUrlKeys) {
            val value = body.optString(key).trim()
            if (value.startsWith("http://") || value.startsWith("https://")) {
                return value
            }
        }

        body.optJSONObject("image")?.let { nested ->
            for (key in directUrlKeys) {
                val value = nested.optString(key).trim()
                if (value.startsWith("http://") || value.startsWith("https://")) {
                    return value
                }
            }
        }

        val hashKeys = listOf("imageHash", "mediaHash", "hash", "fileCacheKey")
        for (key in hashKeys) {
            val value = body.optString(key).trim()
            if (isMediaHash(value)) {
                return "$PUBLIC_MEDIA_BASE_URL/images/thumb/480x480/$value"
            }
        }

        return null
    }

    private fun extractGiphyPreviewUrl(body: JSONObject): String? {
        for (key in listOf("previewPath", "stillPath", "urlPath")) {
            val value = body.optString(key).trim()
            if (value.startsWith("http://") || value.startsWith("https://")) {
                return value
            }
        }
        return null
    }

    private fun extractGaymojiPreviewUrl(body: JSONObject): String? {
        // Here imageHash is a CDN path fragment, not a content hash (same as
        // getGaymojiUrl in chatUtils.ts) — used directly, not via isMediaHash.
        val fragment = body.optString("imageHash").trim()
        if (fragment.isEmpty()) return null
        return "$PUBLIC_MEDIA_BASE_URL/grindr/chat/$fragment"
    }

    private fun resolveNotificationKey(
        isTap: Boolean,
        conversationId: String?,
        senderName: String,
        rawData: JSONObject?,
    ): String {
        if (isTap) {
            val tapSenderId = extractSenderStableId(rawData)
            return "tap:${tapSenderId ?: senderName.lowercase()}"
        }

        if (!conversationId.isNullOrBlank()) {
            return chatNotificationTag(conversationId)
        }

        val senderId = extractSenderStableId(rawData)
        if (!senderId.isNullOrBlank()) {
            return "chat:sender:$senderId"
        }

        return "chat:name:${senderName.lowercase()}"
    }

    // Same tag format used when posting (resolveNotificationKey) and when
    // cancelling (MainActivity) — kept in one place so the two can't drift.
    fun chatNotificationTag(conversationId: String): String = "chat:$conversationId"

    fun normalizeNullableString(value: String?): String? {
        val trimmed = value?.trim().orEmpty()
        if (trimmed.isEmpty() || trimmed.equals("null", ignoreCase = true)) {
            return null
        }
        return trimmed
    }

    fun normalizeSenderName(value: String?): String {
        val trimmed = value?.trim().orEmpty()
        if (
            trimmed.isEmpty() ||
            trimmed.equals("null", ignoreCase = true) ||
            trimmed.equals("SOMEONE_TITLE", ignoreCase = true)
        ) {
            return "Someone"
        }
        return trimmed
    }

    fun queryParameter(action: String, name: String): String? =
        action.substringAfter('?', "")
            .split('&')
            .firstOrNull { it.substringBefore('=') == name }
            ?.substringAfter('=', "")
            ?.let { runCatching { URLDecoder.decode(it, StandardCharsets.UTF_8.name()) }.getOrDefault(it) }
            ?.let(::normalizeNullableString)

    fun parseConversationAndSenderFromAction(action: String?): Pair<String?, String?> {
        val normalized = normalizeNullableString(action) ?: return null to null

        val queryPart = normalized.substringAfter('?', "")
        if (queryPart.isEmpty()) {
            return null to null
        }

        var conversationId: String? = null
        var senderId: String? = null

        queryPart.split('&').forEach { pair ->
            val key = pair.substringBefore('=', "").trim()
            val rawValue = pair.substringAfter('=', "").trim()
            val decodedValue = URLDecoder.decode(rawValue, StandardCharsets.UTF_8.name())

            when (key) {
                "id" -> conversationId = normalizeNullableString(decodedValue)
                "senderId" -> senderId = normalizeNullableString(decodedValue)
            }
        }

        return conversationId to senderId
    }

    private fun extractSenderStableId(rawData: JSONObject?): String? {
        if (rawData == null) {
            return null
        }

        val senderIdKeys = listOf(
            "senderProfileId",
            "senderId",
            "profileId",
            "fromProfileId",
            "authorProfileId",
        )
        for (key in senderIdKeys) {
            val value = normalizeNullableString(rawData.optString(key))
            if (value != null) {
                return value
            }
        }

        val actionValues = parseConversationAndSenderFromAction(rawData.optString("action"))
        if (!actionValues.second.isNullOrBlank()) {
            return actionValues.second
        }

        val messageRaw = rawData.optString("message").trim()
        if (messageRaw.isNotEmpty()) {
            try {
                val messageJson = JSONObject(messageRaw)
                val senderObject = messageJson.optJSONObject("sender")
                if (senderObject != null) {
                    for (key in senderIdKeys) {
                        val value = normalizeNullableString(senderObject.optString(key))
                        if (value != null) {
                            return value
                        }
                    }
                }
            } catch (_: Exception) {
                // Ignore malformed JSON and continue with weaker fallback keys.
            }
        }

        return null
    }

    fun extractConversationId(rawData: JSONObject?): String? {
        if (rawData == null) {
            return null
        }

        val direct = normalizeNullableString(rawData.optString("conversationId"))
        if (direct != null) {
            return direct
        }

        val actionValues = parseConversationAndSenderFromAction(rawData.optString("action"))
        if (!actionValues.first.isNullOrBlank()) {
            return actionValues.first
        }

        val messageRaw = rawData.optString("message").trim()
        if (messageRaw.isNotEmpty()) {
            try {
                val messageJson = JSONObject(messageRaw)
                val id = normalizeNullableString(messageJson.optString("conversationId"))
                if (id != null) {
                    return id
                }
            } catch (_: Exception) {
                // Ignore malformed JSON and keep default fallback behavior.
            }
        }

        return null
    }

    private fun isMediaHash(value: String): Boolean {
        if (value.isBlank()) {
            return false
        }
        if (!(value.length == 32 || value.length == 40 || value.length == 64)) {
            return false
        }
        return value.all { it.isDigit() || it.lowercaseChar() in 'a'..'f' }
    }
}

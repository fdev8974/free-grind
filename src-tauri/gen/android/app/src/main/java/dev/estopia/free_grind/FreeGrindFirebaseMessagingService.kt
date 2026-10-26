package dev.estopia.free_grind

import android.util.Log
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import org.json.JSONArray
import org.json.JSONObject

class FreeGrindFirebaseMessagingService : FirebaseMessagingService() {
    private companion object {
        const val PUSH_VERSION = "2"
        const val UNSEND_DEEPLINK = "grindr://unsend"
        const val CLEAR_DEEPLINK = "grindr://clear"
        const val DIRECT_CAMPAIGN = "_DIRECT"
        const val TAPS_DEEPLINK = "grindr://taps-inbox"
        const val TAP_BODY_KEY = "TAP_NOTIFICATION_BODY"

        // v2 chat text keys → FreeGrind messageType (texts in NotificationStrings).
        // Same set as open-grind's PushStrings, plus message reactions which it misses.
        val CHAT_BODY_TYPES = mapOf(
            TAP_BODY_KEY to null,
            "CHAT_IMAGE_NOTIFICATION_BODY" to "Image",
            "CHAT_EXPIRING_IMAGE_NOTIFICATION_BODY" to "ExpiringImage",
            "CHAT_GIF_NOTIFICATION_BODY" to "Giphy",
            "CHAT_GAYMOJI_NOTIFICATION_BODY" to "Gaymoji",
            "CHAT_LOCATION_NOTIFICATION_BODY" to "Location",
            "CHAT_AUDIO_NOTIFICATION_BODY" to "Audio",
            "CHAT_VIDEO_NOTIFICATION_BODY" to "Video",
            "CHAT_ALBUM_NOTIFICATION_BODY" to "Album",
            "CHAT_ALBUM_CONTENT_REACTION_NOTIFICATION_BODY" to "AlbumContentReaction",
            "CHAT_MESSAGE_REACTION_NOTIFICATION_BODY" to "MessageReaction",
        )
        // A push's `message` blob type → its text key.
        val MESSAGE_TYPE_KEYS = CHAT_BODY_TYPES.entries
            .mapNotNull { (key, type) -> type?.let { it to key } }
            .toMap()
        const val GROWTH_DEEPLINK = "grindr://growth-notification"
        const val RIGHT_NOW_PRODUCT_NAME = "Right Now"
        // The app appends its Right Now product name to these keys' args.
        val PRODUCT_NAME_KEYS = setOf("RIGHT_NOW_REQUEST_NOTIFICATION_BODY", "RIGHT_NOW_REQUEST_APPROVED_NOTIFICATION_BODY")

        val TRACKING_KEYS = listOf("_ab", "af-uinstall-tracking")
        val CAMPAIGN_KEYS = listOf("campaignId", "pinpoint.campaign.campaign_id")
    }

    override fun onMessageReceived(message: RemoteMessage) {
        super.onMessageReceived(message)
        Log.d("FCM", "Received message from: ${message.from}")
        Log.d("FCM", "Message id=${message.messageId}, sentTime=${message.sentTime}, dataSize=${message.data.size}")

        if (message.data.isNotEmpty()) {
            Log.d("FCM", "Message data payload: ${message.data}")
            handleDataPayload(message.data, message.sentTime)
        }

        message.notification?.let {
            Log.d("FCM", "Message Notification Body: ${it.body}")
        }
    }

    private fun handleDataPayload(data: Map<String, String>, sentTime: Long) {
        if (isTrackingOrCampaign(data)) {
            Log.d("FCM", "Ignoring tracking/campaign push")
            return
        }
        if (data["version"] != PUSH_VERSION) {
            Log.d("FCM", "Ignoring push with unsupported version=${data["version"]}")
            return
        }

        val action = data["action"].orEmpty()
        when (action.substringBefore('?').trimEnd('/').lowercase()) {
            UNSEND_DEEPLINK -> {
                NotificationPoster.queryParameter(action, "notificationId")
                    ?.let { NotificationPoster.withdrawPushNotification(this, it) }
                return
            }
            CLEAR_DEEPLINK -> {
                val conversationId = NotificationPoster.queryParameter(action, "conversationId")
                if (conversationId != null) {
                    NotificationPoster.withdrawConversation(this, conversationId)
                } else {
                    val senderIds = NotificationPoster.queryParameter(action, "profileIds")
                        .orEmpty()
                        .split(',')
                        .map(String::trim)
                        .filter(String::isNotEmpty)
                        .toSet()
                    if (senderIds.isNotEmpty()) NotificationPoster.withdrawSenders(this, senderIds)
                }
                return
            }
        }

        val notificationId = NotificationPoster.normalizeNullableString(data["notificationId"])
        if (notificationId != null && NotificationPoster.isDuplicatePush(notificationId)) {
            Log.d("FCM", "Ignoring duplicate push notificationId=$notificationId")
            return
        }

        try {
            val payload = buildPushPayload(data, sentTime)
            val payloadJson = payload.toString()
            Log.d(
                "FCM",
                "Forwarding push payload to React event=${payload.optString("event")} action=${payload.optString("action")}",
            )
            MainActivity.enqueuePushNotification(payloadJson)
            NotificationPoster.postNotification(this, payload)
        } catch (e: Exception) {
            Log.e("FCM", "Failed to parse message data", e)
        }
    }

    // Braze (_ab) and AppsFlyer uninstall probes are never rendered. Campaign
    // keys are also present on ordinary messages with the value "_DIRECT", so
    // only another value marks marketing.
    private fun isTrackingOrCampaign(data: Map<String, String>): Boolean =
        TRACKING_KEYS.any(data::containsKey) ||
            CAMPAIGN_KEYS.any { key -> data[key]?.let { it != DIRECT_CAMPAIGN } == true }

    // Same as the app's qnu.c(): untranslated text is shown as-is; a
    // translated key is looked up (localized) and formatted with its args.
    // Unlike the app (which then shows the raw key), an unknown key is null.
    private fun resolveSystemText(key: String?, argsJson: String?, translate: Boolean): String? {
        val raw = NotificationPoster.normalizeNullableString(key) ?: return null
        if (!translate) return raw
        if (raw !in NotificationStrings.SYSTEM_FALLBACKS) return null
        val args = parseArgs(argsJson).let { if (raw in PRODUCT_NAME_KEYS) it + RIGHT_NOW_PRODUCT_NAME else it }
        return NotificationStrings.get(this, raw, args)
    }

    private fun parseArgs(argsJson: String?): List<Any> = try {
        val array = JSONArray(argsJson ?: "[]")
        (0 until array.length()).map { array.get(it) }
    } catch (e: Exception) {
        emptyList()
    }

    // Non-chat pushes (favorite/tap/recommended online, unread chats, views,
    // boosts, …): a translated title key other than SOMEONE_TITLE, a known
    // system body key, or a growth-notification deeplink. Null for chat/tap
    // pushes, which go through the conversation pipeline below.
    private fun buildSystemPushPayload(data: Map<String, String>, sentTime: Long): JSONObject? {
        val titleKey = data["title"]
        val translateTitle = data["translateTitle"].toBoolean()
        val bodyKey = data["body"]
        val translateBody = data["translateBody"].toBoolean()
        val deeplinkAction = data["action"].orEmpty()
        val actionTarget = deeplinkAction.substringBefore('?').trimEnd('/').lowercase()

        val isSystem = actionTarget == GROWTH_DEEPLINK ||
            (translateTitle && titleKey in NotificationStrings.SYSTEM_FALLBACKS) ||
            (translateBody && bodyKey in NotificationStrings.SYSTEM_FALLBACKS)
        if (!isSystem) return null

        val title = resolveSystemText(titleKey, data["titleArgs"], translateTitle)
        val body = resolveSystemText(bodyKey, data["bodyArgs"], translateBody)
        // Profile-targeted growth types carry the profile in the deeplink.
        val senderId = NotificationPoster.normalizeNullableString(data["senderId"])
            ?: NotificationPoster.queryParameter(deeplinkAction, "profileId")
            ?: NotificationPoster.queryParameter(deeplinkAction, "profileID")

        return JSONObject().apply {
            put("event", "received")
            put("source", "fcm")
            put("receivedAt", System.currentTimeMillis())
            put("sentAt", data["timestamp"]?.toLongOrNull() ?: sentTime)
            put("isSystem", true)
            put("isTap", false)
            put("systemTitle", title.orEmpty())
            put("bodyText", body.orEmpty())
            put("growthType", NotificationPoster.queryParameter(deeplinkAction, "type") ?: JSONObject.NULL)
            put("action", deeplinkAction.ifBlank { null } ?: JSONObject.NULL)
            put("conversationId", JSONObject.NULL)
            put("senderId", senderId ?: JSONObject.NULL)
            put("rawData", JSONObject(data))
        }
    }

    private fun buildPushPayload(data: Map<String, String>, sentTime: Long): JSONObject {
        buildSystemPushPayload(data, sentTime)?.let { return it }

        val titleStr = data["title"] ?: data["senderDisplayName"]
        val senderName = NotificationPoster.normalizeSenderName(this, titleStr)

        val topBody = data["body"]
        val deeplinkAction = data["action"]

        val genericText = NotificationStrings.text(this, NotificationStrings.GENERIC_MESSAGE)
        var messageText = genericText
        var conversationId: String? = null
        var senderId: String? = NotificationPoster.normalizeNullableString(data["senderId"])
        var messageType: String? = null
        // Same id the realtime bridge sends, so NotificationPoster can dedupe
        // per message between the two channels.
        var messageId: String? = null
        // Inline preview shown in the notification (e.g. the actual picture/gif),
        // not just a "Sent you a picture" placeholder. Deliberately not populated
        // for ExpiringImage — that's a view-once/self-destruct message type, so
        // it shouldn't linger visible in the notification shade.
        var previewImageUrl: String? = null

        val actionTarget = deeplinkAction.orEmpty().substringBefore('?').trimEnd('/').lowercase()
        val isTap = topBody == TAP_BODY_KEY || actionTarget == TAPS_DEEPLINK

        // Media and system pushes send a text key (translateBody=true) instead
        // of text; only direct text messages carry plaintext.
        when {
            topBody != null && topBody in CHAT_BODY_TYPES -> {
                messageText = chatBodyText(topBody, data["bodyArgs"])
                messageType = CHAT_BODY_TYPES[topBody]
            }
            // Unknown key — keep the generic text rather than showing the raw key.
            data["translateBody"].toBoolean() || topBody?.startsWith("CHAT_") == true -> Unit
            !topBody.isNullOrBlank() -> messageText = topBody
        }

        val messageJsonStr = data["message"]
        if (messageJsonStr != null) {
            // A malformed `message` blob shouldn't take down the whole payload
            // (and with it the notification's tap/deeplink info) — degrade to
            // the action/senderId-derived fields below instead.
            try {
                val json = JSONObject(messageJsonStr)
                if (json.has("conversationId")) {
                    conversationId = NotificationPoster.normalizeNullableString(json.optString("conversationId"))
                }
                messageId = NotificationPoster.normalizeNullableString(json.optString("messageId"))

                val type = json.optString("type")
                if (type.isNotEmpty()) {
                    messageType = type
                    messageText = when (type) {
                        "Text" -> extractTextMessage(json, messageText)
                        else -> MESSAGE_TYPE_KEYS[type]?.let { chatBodyText(it, data["bodyArgs"]) } ?: messageText
                    }
                    previewImageUrl = NotificationPoster.extractMessagePreviewImageUrl(json.optJSONObject("body"), type)
                }
            } catch (e: Exception) {
                Log.e("FCM", "Failed to parse message payload, continuing without it", e)
            }
        }

        val actionValues = NotificationPoster.parseConversationAndSenderFromAction(deeplinkAction)
        if (conversationId.isNullOrBlank()) {
            conversationId = actionValues.first
        }
        if (senderId.isNullOrBlank()) {
            senderId = actionValues.second
        }

        messageText = messageText.trim().ifBlank { genericText }

        val action = if (isTap) "taps" else conversationId?.let { "chat:$it" }
        // Which saved account this push is for (see PushAccounts); null for
        // taps, whose payload doesn't tell.
        val accountId = if (isTap) null else PushAccounts.recipientOf(this, conversationId, senderId)

        return JSONObject().apply {
            put("event", "received")
            put("source", "fcm")
            put("receivedAt", System.currentTimeMillis())
            // Line order in the conversation notification, as open-grind does.
            put("sentAt", data["timestamp"]?.toLongOrNull() ?: sentTime)
            put("senderName", senderName)
            put("bodyText", messageText)
            put("isTap", isTap)
            put("action", action ?: JSONObject.NULL)
            put("conversationId", conversationId ?: JSONObject.NULL)
            put("senderId", senderId ?: JSONObject.NULL)
            put("messageType", messageType ?: JSONObject.NULL)
            put("messageId", messageId ?: JSONObject.NULL)
            put("previewImageUrl", previewImageUrl ?: JSONObject.NULL)
            put("accountId", accountId ?: JSONObject.NULL)
            put("rawData", JSONObject(data))
        }
    }

    // The reaction text names the reactor via bodyArgs; without one (or
    // when the args don't fit) it falls back to the nameless variant.
    private fun chatBodyText(key: String, argsJson: String?): String {
        val args = parseArgs(argsJson)
        if (key == "CHAT_MESSAGE_REACTION_NOTIFICATION_BODY" && args.isEmpty()) {
            return NotificationStrings.text(this, NotificationStrings.MESSAGE_REACTION_NO_NAME)
        }
        return NotificationStrings.get(this, key, args) ?: NotificationStrings.text(this, NotificationStrings.GENERIC_MESSAGE)
    }

    private fun extractTextMessage(messageJson: JSONObject, fallbackText: String): String {
        val body = messageJson.optJSONObject("body")
        val directText = body?.optString("text")?.trim().orEmpty()
        if (directText.isNotEmpty()) {
            return directText
        }

        val plainBody = messageJson.optString("body").trim()
        if (plainBody.isNotEmpty() && plainBody != "{}") {
            return plainBody
        }

        return fallbackText
    }

    override fun onNewToken(token: String) {
        super.onNewToken(token)
        Log.d("FCM", "Refreshed token (len=${token.length}), dispatching to webview")
        MainActivity.onFcmTokenRefreshed(token)
    }
}

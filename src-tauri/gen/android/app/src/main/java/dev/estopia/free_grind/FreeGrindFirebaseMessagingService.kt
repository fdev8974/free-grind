package dev.estopia.free_grind

import android.util.Log
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import org.json.JSONObject

class FreeGrindFirebaseMessagingService : FirebaseMessagingService() {
    private companion object {
        const val PUSH_VERSION = "2"
        const val UNSEND_DEEPLINK = "grindr://unsend"
        const val CLEAR_DEEPLINK = "grindr://clear"
        const val DIRECT_CAMPAIGN = "_DIRECT"
        const val TAPS_DEEPLINK = "grindr://taps-inbox"
        const val TAP_BODY_KEY = "TAP_NOTIFICATION_BODY"

        // v2 text keys → (display text, FreeGrind messageType). Same set as
        // open-grind's PushStrings, plus message reactions which it misses.
        val BODY_TEXTS = mapOf(
            TAP_BODY_KEY to ("Tapped you" to null),
            "CHAT_IMAGE_NOTIFICATION_BODY" to ("Sent you a picture" to "Image"),
            "CHAT_EXPIRING_IMAGE_NOTIFICATION_BODY" to ("Sent you an expiring picture" to "ExpiringImage"),
            "CHAT_GIF_NOTIFICATION_BODY" to ("Sent you a gif" to "Giphy"),
            "CHAT_GAYMOJI_NOTIFICATION_BODY" to ("Sent you a gaymoji" to "Gaymoji"),
            "CHAT_LOCATION_NOTIFICATION_BODY" to ("Sent you their location" to "Location"),
            "CHAT_AUDIO_NOTIFICATION_BODY" to ("Sent you a voice message" to "Audio"),
            "CHAT_VIDEO_NOTIFICATION_BODY" to ("Sent you a video" to "Video"),
            "CHAT_ALBUM_NOTIFICATION_BODY" to ("Shared an album with you" to "Album"),
            "CHAT_ALBUM_CONTENT_REACTION_NOTIFICATION_BODY" to ("Liked your album picture" to "AlbumContentReaction"),
            "CHAT_MESSAGE_REACTION_NOTIFICATION_BODY" to ("Reacted to your message" to "MessageReaction"),
        )
        val TRACKING_KEYS = listOf("_ab", "af-uinstall-tracking")
        val CAMPAIGN_KEYS = listOf("campaignId", "pinpoint.campaign.campaign_id")
    }

    override fun onMessageReceived(message: RemoteMessage) {
        super.onMessageReceived(message)
        Log.d("FCM", "Received message from: ${message.from}")
        Log.d("FCM", "Message id=${message.messageId}, sentTime=${message.sentTime}, dataSize=${message.data.size}")

        if (message.data.isNotEmpty()) {
            Log.d("FCM", "Message data payload: ${message.data}")
            handleDataPayload(message.data)
        }

        message.notification?.let {
            Log.d("FCM", "Message Notification Body: ${it.body}")
        }
    }

    private fun handleDataPayload(data: Map<String, String>) {
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
            val payload = buildPushPayload(data)
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

    private fun buildPushPayload(data: Map<String, String>): JSONObject {
        val titleStr = data["title"] ?: data["senderDisplayName"]
        val senderName = NotificationPoster.normalizeSenderName(titleStr)

        val topBody = data["body"]
        val deeplinkAction = data["action"]

        var messageText = "Sent you a message"
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
        val translated = topBody?.let(BODY_TEXTS::get)
        when {
            translated != null -> {
                messageText = translated.first
                messageType = translated.second
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
                        "Image" -> "Sent you a picture"
                        "Giphy" -> "Sent you a gif"
                        "Location" -> "Sent you their location"
                        "Audio" -> "Sent you a voice message"
                        "Gaymoji" -> "Sent you a gaymoji"
                        "ExpiringImage" -> "Sent you an expiring picture"
                        "Album" -> "Shared an album with you"
                        "AlbumContentReaction" -> "Liked your album picture"
                        "Video" -> "Sent you a video"
                        else -> messageText
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

        messageText = messageText.trim().ifBlank { "Sent you a message" }

        val action = if (isTap) "taps" else conversationId?.let { "chat:$it" }

        return JSONObject().apply {
            put("event", "received")
            put("source", "fcm")
            put("receivedAt", System.currentTimeMillis())
            put("senderName", senderName)
            put("bodyText", messageText)
            put("isTap", isTap)
            put("action", action ?: JSONObject.NULL)
            put("conversationId", conversationId ?: JSONObject.NULL)
            put("senderId", senderId ?: JSONObject.NULL)
            put("messageType", messageType ?: JSONObject.NULL)
            put("messageId", messageId ?: JSONObject.NULL)
            put("previewImageUrl", previewImageUrl ?: JSONObject.NULL)
            put("rawData", JSONObject(data))
        }
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

package dev.estopia.free_grind

import android.content.Context
import android.util.Log
import org.json.JSONObject
import java.util.Locale

/**
 * Localized notification texts for the native push pipeline. FCM wakes the
 * process without the WebView (and so without i18next), so the frontend
 * pushes its `push_notifications.*` translations down via
 * `FreeGrindBridge.setNotificationStrings(...)` and they're persisted here.
 * Keys are the Grindr push text keys (e.g. FAVORITE_ONLINE_NOTIFICATION_TITLE)
 * plus a few of our own; templates use String.format placeholders (%1$s).
 * Anything not synced yet falls back to the 26.21 app's English original.
 */
object NotificationStrings {
    private const val PREFS_NAME = "free_grind_notification_strings"
    private const val PREF_STRINGS = "strings"

    const val SOMEONE = "SOMEONE"
    const val GENERIC_MESSAGE = "GENERIC_MESSAGE"
    const val OPEN_CHAT = "OPEN_CHAT"
    const val OPEN_PROFILE = "OPEN_PROFILE"
    const val TAPS_TITLE = "TAPS_TITLE"
    const val MESSAGE_REACTION_NO_NAME = "CHAT_MESSAGE_REACTION_NO_NAME_NOTIFICATION_BODY"

    // English fallbacks; everything Grindr sends is the 26.21 original
    // (strings.xml, via qnu.stringResourcesMap).
    private val OWN_FALLBACKS = mapOf(
        SOMEONE to "Someone",
        GENERIC_MESSAGE to "Sent you a message",
        OPEN_CHAT to "Open chat",
        OPEN_PROFILE to "Open profile",
        TAPS_TITLE to "Taps",
        MESSAGE_REACTION_NO_NAME to "Reacted to your message",
    )

    private val CHAT_FALLBACKS = mapOf(
        "TAP_NOTIFICATION_BODY" to "Tapped you",
        "CHAT_IMAGE_NOTIFICATION_BODY" to "Sent you a picture",
        "CHAT_EXPIRING_IMAGE_NOTIFICATION_BODY" to "Sent you an expiring image",
        "CHAT_GIF_NOTIFICATION_BODY" to "Sent you a GIF",
        "CHAT_GAYMOJI_NOTIFICATION_BODY" to "Sent you a Gaymoji",
        "CHAT_LOCATION_NOTIFICATION_BODY" to "Sent you their location",
        "CHAT_AUDIO_NOTIFICATION_BODY" to "Sent you an audio message",
        "CHAT_VIDEO_NOTIFICATION_BODY" to "Sent you a video",
        "CHAT_ALBUM_NOTIFICATION_BODY" to "Shared their album",
        "CHAT_ALBUM_CONTENT_REACTION_NOTIFICATION_BODY" to "Liked your album content",
        "CHAT_MESSAGE_REACTION_NOTIFICATION_BODY" to "%1\$s reacted to your message",
    )

    // Non-chat pushes: favorite/tap/… online, unread chats, views, boosts,
    // A-List, …. "" marks keys the app renders as its own name (app_name) —
    // callers substitute the active disguise label instead.
    val SYSTEM_FALLBACKS = mapOf(
        "FAVORITE_ONLINE_NOTIFICATION_TITLE" to "Your favorite is online…",
        "FAVORITE_ONLINE_NOTIFICATION_BODY" to "Say hello before they log off.",
        "MULTIPLE_FAVORITES_ONLINE_NOTIFICATION_TITLE" to "You’ve got favorites…",
        "MULTIPLE_FAVORITES_ONLINE_NOTIFICATION_BODY" to "Online right now. Take your pick.",
        "TAPPED_ONLINE_NOTIFICATION_TITLE" to "Your tap just came online…",
        "TAPPED_ONLINE_NOTIFICATION_BODY" to "You made the first move. Now say hello.",
        "RECOMMENDED_ONLINE_NOTIFICATION_TITLE" to "Your type is nearby.",
        "RECOMMENDED_ONLINE_NOTIFICATION_BODY" to "They're online right now. Say hello before the moment passes…",
        "MEDIA_RECIPIENT_ONLINE_NOTIFICATION_TITLE" to "The guy you sent pics to…",
        "MEDIA_RECIPIENT_ONLINE_NOTIFICATION_BODY" to "Is online now. Pick up where you left off.",
        "UNREAD_CHATS_NOTIFICATION_TITLE" to "New chats waiting.",
        "UNREAD_CHATS_NOTIFICATION_BODY" to "Go see who messaged. Ball's in your court.",
        "VIEWED_PROFILE_NOTIFICATION_TITLE" to "You’re getting views…",
        "VIEWED_PROFILE_NOTIFICATION_BODY" to "See who’s checking you out. Your views are unlocked for 24 hours.",
        "A_LIST_UPDATES_TITLE" to "A-List updates",
        "A_LIST_UPDATES_BODY_1" to "You've got an active A-List! %1\$s has an update. Take a look at what you've missed!",
        "A_LIST_UPDATES_BODY_2" to "You've got an active A-List! %1\$s and %2\$s have updates. Take a look at what you've missed!",
        "A_LIST_UPDATES_BODY_3" to "You've got an active A-List! %1\$s, %2\$s, and %3\$s have updates. Take a look at what you've missed!",
        "A_LIST_UPDATES_BODY_4" to "You've got an active A-List! %1\$s, %2\$s, and %3\$s others have updates. Take a look at what you've missed!",
        "BOOST_NOTIFICATION_TITLE" to "Boost Complete ⚡",
        "BOOST_NOTIFICATION_BODY" to "Tap to view your results",
        "SUPER_BOOST_NOTIFICATION_TITLE" to "Super Boost Complete ⚡",
        "SUPER_BOOST_NOTIFICATION_BODY" to "Tap to view your results",
        "MEGA_BOOST_NOTIFICATION_TITLE" to "Mega Boost Complete ⚡",
        "MEGA_BOOST_NOTIFICATION_BODY" to "Tap to view your results",
        "TRIAL_REMINDER_NOTIFICATION_TITLE" to "7-Day Free Trial",
        "TRIAL_REMINDER_NOTIFICATION_BODY" to "Your trial will end in 48 hours.",
        "SPANK_BANK_FAVORITE_UPDATE_TITLE" to "Your favorite just updated their album 👀",
        "SPANK_BANK_BATCHED_UPDATE_TITLE" to "%1\$s people have updated their albums 👀",
        "SPANK_BANK_V2_FAVORITE_UPDATE_TITLE" to "",
        "SPANK_BANK_V2_BATCHED_UPDATE_TITLE" to "",
        "SPANK_BANK_TAP_TO_SEE_BODY" to "Tap to view",
        "SPANK_BANK_V2_FAVORITE_UPDATE_BODY" to "Your favorite %1\$s just updated their album 👀",
        "SPANK_BANK_V2_BATCHED_UPDATE_BODY" to "%1\$s people have updated their albums",
        "DISCOVER_NEW_REC_NOTIFICATION_TITLE" to "New Hottie in Discover",
        "DISCOVER_NEW_REC_NOTIFICATION_BODY" to "In your feed today only! Tap to view.",
        "RIGHT_NOW_REQUEST_NOTIFICATION_TITLE" to "",
        "RIGHT_NOW_REQUEST_NOTIFICATION_BODY" to "%1\$s request received",
        "RIGHT_NOW_REQUEST_APPROVED_NOTIFICATION_TITLE" to "",
        "RIGHT_NOW_REQUEST_APPROVED_NOTIFICATION_BODY" to "%1\$s request accepted",
        "COUPON_AUTO_APPLIED_TITLE" to "Congratulations",
        "COUPON_AUTO_APPLIED_BODY" to "A free month of %1\$s is yours",
    )

    private val FALLBACKS = OWN_FALLBACKS + CHAT_FALLBACKS + SYSTEM_FALLBACKS

    @Volatile private var synced: JSONObject? = null

    /** Persists the frontend's `{ KEY: template }` map (replacing the previous one). */
    fun update(context: Context, json: String) {
        try {
            val strings = JSONObject(json)
            context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .edit().putString(PREF_STRINGS, strings.toString()).apply()
            synced = strings
            Log.d("FCM", "NotificationStrings updated (${strings.length()} keys)")
        } catch (e: Exception) {
            Log.e("FCM", "Failed to parse notification strings", e)
        }
    }

    private fun syncedStrings(context: Context): JSONObject {
        synced?.let { return it }
        val stored = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).getString(PREF_STRINGS, null)
        return (stored?.let { runCatching { JSONObject(it) }.getOrNull() } ?: JSONObject()).also { synced = it }
    }

    /**
     * The localized text for [key] with [args] filled in, or null for a key
     * we don't know. Synced templates escape a literal % as %%, so every
     * template goes through String.format, args or not.
     */
    fun get(context: Context, key: String, args: List<Any> = emptyList()): String? {
        val fallback = FALLBACKS[key] ?: return null
        val template = syncedStrings(context).optString(key).takeIf { it.isNotBlank() }
        if (template != null) {
            runCatching { return String.format(Locale.getDefault(), template, *args.toTypedArray()) }
        }
        return runCatching { String.format(Locale.US, fallback, *args.toTypedArray()) }.getOrDefault(fallback)
    }

    fun text(context: Context, key: String): String = get(context, key) ?: key
}

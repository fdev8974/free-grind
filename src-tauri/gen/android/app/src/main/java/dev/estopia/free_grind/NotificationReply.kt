package dev.estopia.free_grind

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import androidx.core.app.RemoteInput
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

/**
 * Inline "Reply" on chat notifications (the RemoteInput action added in
 * NotificationPoster). Sending has to go through the frontend — auth, the
 * realtime socket and the spoofed REST client all live there — so a reply
 * is only handed over to the WebView via MainActivity.enqueueNotificationReply
 * (`fg:notification-reply`, see NotificationReplyBridge.tsx), which reports
 * back through FreeGrindBridge.notificationReplyResult.
 *
 * Replies are persisted until the WebView has taken them: a chat push can
 * arrive with no WebView alive (FCM woke the process), and Android 12+ won't
 * let a notification action start the activity from a receiver. Such a reply
 * goes out the next time the app is opened, and its line says so.
 */
object NotificationReply {
    const val ACTION_REPLY = "dev.estopia.free_grind.action.NOTIFICATION_REPLY"
    const val KEY_TEXT = "reply_text"
    const val EXTRA_CONVERSATION_ID = "dev.estopia.free_grind.extra.REPLY_CONVERSATION_ID"
    const val EXTRA_TARGET_PROFILE_ID = "dev.estopia.free_grind.extra.REPLY_TARGET_PROFILE_ID"
    const val EXTRA_NOTIFICATION_TAG = "dev.estopia.free_grind.extra.REPLY_NOTIFICATION_TAG"

    private const val PREFS_NAME = "free_grind_notification_replies"
    private const val PREF_PENDING = "pending"

    /** Queues [reply] until the WebView confirms it took it (see [remove]). */
    @Synchronized
    fun persist(context: Context, reply: JSONObject) {
        val pending = pending(context).put(reply)
        prefs(context).edit().putString(PREF_PENDING, pending.toString()).apply()
    }

    @Synchronized
    fun pending(context: Context): JSONArray =
        prefs(context).getString(PREF_PENDING, null)
            ?.let { runCatching { JSONArray(it) }.getOrNull() }
            ?: JSONArray()

    @Synchronized
    fun remove(context: Context, id: String) {
        val pending = pending(context)
        val kept = JSONArray()
        for (i in 0 until pending.length()) {
            val reply = pending.optJSONObject(i) ?: continue
            if (reply.optString("id") != id) kept.put(reply)
        }
        prefs(context).edit().putString(PREF_PENDING, kept.toString()).apply()
    }

    private fun prefs(context: Context) = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
}

class NotificationReplyReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != NotificationReply.ACTION_REPLY) return
        val tag = intent.getStringExtra(NotificationReply.EXTRA_NOTIFICATION_TAG) ?: return
        val conversationId = intent.getStringExtra(NotificationReply.EXTRA_CONVERSATION_ID)
        val targetProfileId = intent.getStringExtra(NotificationReply.EXTRA_TARGET_PROFILE_ID)
        val text = RemoteInput.getResultsFromIntent(intent)
            ?.getCharSequence(NotificationReply.KEY_TEXT)
            ?.toString()
            ?.trim()
            .orEmpty()

        val pendingResult = goAsync()
        Thread {
            try {
                if (text.isEmpty() || conversationId == null || targetProfileId == null) {
                    // Still re-post: until the card is updated, System UI keeps
                    // spinning on the reply field.
                    NotificationPoster.refreshAfterReply(context, tag)
                    return@Thread
                }
                val id = UUID.randomUUID().toString()
                val reply = JSONObject()
                    .put("id", id)
                    .put("conversationId", conversationId)
                    .put("targetProfileId", targetProfileId)
                    .put("text", text)
                    .put("notificationTag", tag)
                    .put("createdAt", System.currentTimeMillis())
                NotificationReply.persist(context, reply)
                val delivered = MainActivity.enqueueNotificationReply(reply.toString())
                NotificationPoster.appendReplyLine(
                    context, tag, id, text,
                    note = if (delivered) null else NotificationStrings.text(context, NotificationStrings.REPLY_QUEUED),
                )
                Log.d("FCM", "Notification reply queued id=$id conversation=$conversationId delivered=$delivered")
            } catch (e: Exception) {
                Log.e("FCM", "Failed to handle notification reply", e)
            } finally {
                pendingResult.finish()
            }
        }.start()
    }
}

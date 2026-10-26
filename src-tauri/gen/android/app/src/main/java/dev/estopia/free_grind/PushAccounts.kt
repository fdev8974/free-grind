package dev.estopia.free_grind

import android.content.Context
import android.util.Log
import org.json.JSONObject

/**
 * The saved accounts the push pipeline delivers for, mirrored from the
 * frontend through `FreeGrindBridge.setPushAccounts(...)`. Persisted, since
 * FCM can wake a killed app and post before any WebView exists.
 *
 * The device's FCM token is registered for every saved account, so pushes
 * for all of them arrive here. Grindr's V2 payload names no recipient, but a
 * conversation id is the two participants' profile ids ("a:b"), so a chat
 * push resolves to the participant that isn't the sender. Taps and system
 * pushes stay unattributed and are treated as the active account's.
 */
object PushAccounts {
    private const val PREFS_NAME = "free_grind_push_accounts"
    private const val PREF_STATE = "state"

    private data class State(val activeProfileId: String?, val labels: Map<String, String>)

    @Volatile
    private var state: State? = null

    /** `{ activeProfileId: string|null, accounts: [{ profileId, label }] }` */
    fun update(context: Context, json: String) {
        try {
            val parsed = parse(JSONObject(json))
            state = parsed
            prefs(context).edit().putString(PREF_STATE, json).apply()
            Log.d("FCM", "PushAccounts active=${parsed.activeProfileId} accounts=${parsed.labels.keys}")
        } catch (e: Exception) {
            Log.e("FCM", "Failed to parse push accounts", e)
        }
    }

    /** The account a chat push was sent to, or null when it can't be told. */
    fun recipientOf(context: Context, conversationId: String?, senderId: String?): String? {
        val participants = conversationId?.split(':')?.map(String::trim)
            ?.takeIf { it.size == 2 && it.none(String::isEmpty) }
            ?: return null
        if (senderId != null && senderId in participants) {
            return participants.firstOrNull { it != senderId }
        }
        // No (or a foreign) sender: whichever participant is a saved account.
        val labels = load(context)?.labels.orEmpty()
        return participants.singleOrNull { it in labels }
    }

    /** Null (unattributed) counts as the active account, as before multi-account push. */
    fun isActive(context: Context, accountId: String?): Boolean {
        val active = load(context)?.activeProfileId
        return accountId == null || active == null || accountId == active
    }

    /**
     * False only for an account the frontend has told us about and that is no
     * longer saved — its push registration may outlive the removal. Before
     * the first sync everything passes.
     */
    fun isSaved(context: Context, accountId: String): Boolean {
        val labels = load(context)?.labels ?: return true
        return labels.isEmpty() || accountId in labels
    }

    /** Shown on the notification once there's more than one account to tell apart. */
    fun label(context: Context, accountId: String?): String? {
        val labels = load(context)?.labels ?: return null
        if (accountId == null || labels.size < 2) return null
        return labels[accountId]?.ifBlank { null }
    }

    private fun load(context: Context): State? {
        state?.let { return it }
        val stored = prefs(context).getString(PREF_STATE, null) ?: return null
        return try {
            parse(JSONObject(stored)).also { state = it }
        } catch (e: Exception) {
            Log.e("FCM", "Failed to read stored push accounts", e)
            null
        }
    }

    private fun parse(json: JSONObject): State {
        val accounts = json.optJSONArray("accounts")
        val labels = buildMap {
            for (i in 0 until (accounts?.length() ?: 0)) {
                val account = accounts?.optJSONObject(i) ?: continue
                val profileId = NotificationPoster.normalizeNullableString(account.optString("profileId")) ?: continue
                put(profileId, account.optString("label").trim())
            }
        }
        return State(NotificationPoster.normalizeNullableString(json.optString("activeProfileId")), labels)
    }

    private fun prefs(context: Context) = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
}

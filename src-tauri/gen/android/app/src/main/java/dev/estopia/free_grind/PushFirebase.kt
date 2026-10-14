package dev.estopia.free_grind

import android.content.Context
import android.util.Log
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.messaging.FirebaseMessaging

/**
 * Owns the Firebase setup for push. Initialized from FreeGrindApplication so
 * it's ready whenever the process starts — including when a push wakes a
 * killed app and MainActivity never runs.
 */
object PushFirebase {
    private const val TAG = "FCM"

    @Volatile
    private var initialized = false

    @Synchronized
    fun initialize(context: Context) {
        if (initialized) return
        try {
            val spoofed = SpoofedContext(context.applicationContext)
            val options = FirebaseOptions.Builder()
                .setApplicationId(context.getString(R.string.fcm_google_app_id))
                .setProjectId(context.getString(R.string.fcm_project_id))
                .setApiKey(context.getString(R.string.fcm_google_api_key))
                .setGcmSenderId(context.getString(R.string.fcm_gcm_defaultSenderId))
                .build()
            if (FirebaseApp.getApps(spoofed).isEmpty()) {
                FirebaseApp.initializeApp(spoofed, options)
            }
            initialized = true
            Log.d(TAG, "Firebase initialized with spoofed context")
        } catch (t: Throwable) {
            Log.e(TAG, "Firebase initialization failed; continuing without push", t)
        }
    }

    fun token(onToken: (String) -> Unit) {
        if (!initialized) {
            Log.w(TAG, "Firebase not initialized; no push token")
            return
        }
        try {
            FirebaseMessaging.getInstance().token.addOnCompleteListener { task ->
                if (task.isSuccessful) {
                    onToken(task.result)
                } else {
                    Log.w(TAG, "Failed to get push token", task.exception)
                }
            }
        } catch (t: Throwable) {
            Log.e(TAG, "Firebase Messaging unavailable; continuing without push token", t)
        }
    }
}
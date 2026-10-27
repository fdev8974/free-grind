package dev.estopia.free_grind

import android.app.Activity
import android.app.ActivityManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.ComponentName
import android.content.ContentResolver
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.BitmapFactory
import android.media.AudioAttributes
import android.net.Uri
import android.util.Log

/**
 * Swaps the app's launcher icon/name between the real "Free Grind" identity
 * and a decoy (Calculator/Notes/Weather), by enabling exactly one of the
 * activity-alias entries declared in AndroidManifest.xml and disabling the
 * rest. All aliases target the same MainActivity, so this never affects
 * which code runs — only what the home screen/app drawer show before the
 * app is opened.
 *
 * PackageManager.DONT_KILL_APP is passed so this can be called from a
 * running JsBridge call without the process dying mid-call; the system
 * still notifies launchers of the icon/label change via a package-changed
 * broadcast. Some launchers only pick this up after returning to the home
 * screen (or a launcher restart) — a known limitation of this technique,
 * not a bug here.
 */
object AppDisguise {
  // Shared with MainActivity.ensureNotificationChannels and NotificationPoster,
  // which both (re)create these same two channel ids via messageChannel().
  // A channel's sound is fixed by whichever createNotificationChannel call
  // comes first, so bumping the suffix is the only way to fix the sound on
  // installs whose _v2 channels were created soundless (default OS tone).
  const val CHAT_CHANNEL_ID = "free_grind_chat_notifications_v3"
  const val TAPS_CHANNEL_ID = "free_grind_taps_notifications_v3"
  private val LEGACY_CHANNEL_IDS = listOf(
    "free_grind_chat_notifications", "free_grind_taps_notifications",
    "free_grind_chat_notifications_v2", "free_grind_taps_notifications_v2",
  )
  // Non-chat pushes (favorite online, views, boosts, …); only NotificationPoster
  // creates it, on the first such push.
  const val ACTIVITY_CHANNEL_ID = "free_grind_activity_notifications"

  enum class Identity(
    val id: String,
    val aliasSimpleName: String,
    // Notification channel names shown in Android's per-app notification
    // settings — kept generic (not "Free Grind"-themed) for the decoy
    // identities so that surface doesn't give the disguise away either.
    val chatChannelName: String,
    val tapsChannelName: String,
    val activityChannelName: String,
    // Same label/icon shown on the launcher alias — reused for the Recents
    // (task switcher) card and the custom splash dialog, the two other
    // places that otherwise keep showing the real "Free Grind" identity
    // regardless of which alias is enabled.
    val labelRes: Int,
    val iconRes: Int,
    // Monochrome status-bar/notification small icon; the fox silhouette
    // would otherwise give every decoy away on each incoming notification.
    val notificationIconRes: Int,
  ) {
    DEFAULT(
      "default", "DisguiseDefaultAlias", "Chat Messages", "Taps", "Activity",
      R.string.app_name, R.mipmap.ic_launcher,
      R.drawable.ic_notification_silhouette,
    ),
    CALCULATOR(
      "calculator", "DisguiseCalculatorAlias", "Reminders", "Alerts", "Updates",
      R.string.disguise_name_calculator, R.mipmap.ic_launcher_calculator,
      R.drawable.ic_notification_calculator,
    ),
    NOTES(
      "notes", "DisguiseNotesAlias", "Reminders", "Alerts", "Updates",
      R.string.disguise_name_notes, R.mipmap.ic_launcher_notes,
      R.drawable.ic_notification_notes,
    ),
    WEATHER(
      "weather", "DisguiseWeatherAlias", "Reminders", "Alerts", "Updates",
      R.string.disguise_name_weather, R.mipmap.ic_launcher_weather,
      R.drawable.ic_notification_weather,
    );

    companion object {
      fun fromId(id: String): Identity? = entries.find { it.id == id }
    }
  }

  private fun aliasComponent(context: Context, identity: Identity): ComponentName =
    ComponentName(context.packageName, "${context.packageName}.${identity.aliasSimpleName}")

  /** Enables the alias for [identity] and disables all the others. Returns true on success. */
  fun applyDisguise(context: Context, identity: Identity): Boolean {
    return try {
      val pm = context.packageManager
      for (candidate in Identity.entries) {
        val state = if (candidate == identity) {
          PackageManager.COMPONENT_ENABLED_STATE_ENABLED
        } else {
          PackageManager.COMPONENT_ENABLED_STATE_DISABLED
        }
        pm.setComponentEnabledSetting(aliasComponent(context, candidate), state, PackageManager.DONT_KILL_APP)
      }
      refreshChannelNames(context, identity)
      Log.d("AppDisguise", "Applied disguise: ${identity.id}")
      true
    } catch (t: Throwable) {
      Log.e("AppDisguise", "Failed to apply disguise ${identity.id}", t)
      false
    }
  }

  /** Reads back which alias is currently enabled; falls back to DEFAULT if none/multiple report enabled. */
  fun currentDisguise(context: Context): Identity {
    val pm = context.packageManager
    for (candidate in Identity.entries) {
      val setting = pm.getComponentEnabledSetting(aliasComponent(context, candidate))
      val isEnabled = setting == PackageManager.COMPONENT_ENABLED_STATE_ENABLED ||
        (setting == PackageManager.COMPONENT_ENABLED_STATE_DEFAULT && candidate == Identity.DEFAULT)
      if (isEnabled) {
        return candidate
      }
    }
    return Identity.DEFAULT
  }

  /**
   * Updates this task's Recents/multitasking-switcher card (icon + label) to
   * match [identity]. Without this, Recents falls back to the app's real
   * <application> icon/label ("Free Grind") regardless of which launcher
   * alias is enabled — arguably the most visible remaining leak, since
   * Recents is commonly glanced at by anyone else holding the phone. Safe
   * to call repeatedly (on every cold start and right after switching).
   */
  fun applyTaskDescription(activity: Activity, identity: Identity) {
    try {
      val label = activity.getString(identity.labelRes)
      val icon = BitmapFactory.decodeResource(activity.resources, identity.iconRes)
      @Suppress("DEPRECATION")
      activity.setTaskDescription(ActivityManager.TaskDescription(label, icon))
    } catch (t: Throwable) {
      Log.e("AppDisguise", "Failed to update task description for ${identity.id}", t)
    }
  }

  /**
   * The chat/taps channel, always with the Free Grind message sound. Every
   * place that creates these channels must go through here: a first creation
   * without setSound() would lock the channel to the OS default tone.
   */
  fun messageChannel(context: Context, identity: Identity, isTap: Boolean): NotificationChannel =
    NotificationChannel(
      if (isTap) TAPS_CHANNEL_ID else CHAT_CHANNEL_ID,
      if (isTap) identity.tapsChannelName else identity.chatChannelName,
      NotificationManager.IMPORTANCE_HIGH,
    ).apply {
      description = if (isTap) "Notifications for incoming taps" else "Notifications for new chat messages"
      enableLights(true)
      enableVibration(true)
      setShowBadge(true)
      setSound(
        messageSoundUri(context),
        AudioAttributes.Builder()
          .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
          .setUsage(AudioAttributes.USAGE_NOTIFICATION)
          .build(),
      )
    }

  fun messageSoundUri(context: Context): Uri =
    Uri.parse("${ContentResolver.SCHEME_ANDROID_RESOURCE}://${context.packageName}/${R.raw.free_grind_message}")

  /** Creates/renames the chat + taps channels and drops superseded channel ids. */
  fun ensureMessageChannels(context: Context, identity: Identity = currentDisguise(context)) {
    val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    for (id in LEGACY_CHANNEL_IDS) {
      if (nm.getNotificationChannel(id) != null) nm.deleteNotificationChannel(id)
    }
    nm.createNotificationChannel(messageChannel(context, identity, isTap = false))
    nm.createNotificationChannel(messageChannel(context, identity, isTap = true))
  }

  // Renaming an *existing* channel just means calling createNotificationChannel
  // again with a new name for the same id — per-channel fields the user could
  // have customized (importance, sound) are left alone by the system on
  // repeat calls; only name/description apply. So this is safe to call both
  // at startup and right after switching disguises, without needing to
  // delete+recreate the channel (which would reset those user customizations).
  private fun refreshChannelNames(context: Context, identity: Identity) {
    ensureMessageChannels(context, identity)
    val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    // Only renamed once it exists — it's created lazily on the first such push.
    if (nm.getNotificationChannel(ACTIVITY_CHANNEL_ID) != null) {
      nm.createNotificationChannel(
        NotificationChannel(ACTIVITY_CHANNEL_ID, identity.activityChannelName, NotificationManager.IMPORTANCE_DEFAULT)
      )
    }
  }
}

package dev.estopia.free_grind

import android.app.Activity
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin

/** Rust-side handle on FacebookOAuthActivity (see api/facebook_oauth/android.rs). */
@TauriPlugin
class FacebookOAuthPlugin(private val activity: Activity) : Plugin(activity) {

  @Command
  fun dismiss(invoke: Invoke) {
    FacebookOAuthActivity.dismiss()
    invoke.resolve(JSObject())
  }

  @Command
  fun clearProfile(invoke: Invoke) {
    FacebookOAuthActivity.clearIsolatedProfile()
    invoke.resolve(JSObject())
  }
}

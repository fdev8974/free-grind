mod api;
mod commands;
mod error;
mod instance_lock;
mod media;
mod media_proxy;
mod state;
mod storage;
mod windows_instance;

use crate::state::AppState;

/// The app window; the media proxy refuses every other webview.
pub(crate) const MAIN_WINDOW_LABEL: &str = "main";

/// Tells the frontend this binary serves `fgmedia:` before any of its
/// scripts run. An OTA bundle can land on an older binary without the proxy,
/// and src/utils/mediaProxy.ts then keeps loading media directly.
fn media_proxy_flag<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::<R, ()>::new("fg-media-proxy")
        .js_init_script("window.__FG_MEDIA_PROXY__ = true;".to_owned())
        .build()
}

/// Builds the main window, deferred (`create: false` in tauri.conf.json) so
/// the User-Agent carries the running version instead of a hardcoded one.
/// On Linux it also loads the media proxy's GStreamer source for <video>. An
/// empty library means build.rs couldn't compile it; video then goes through
/// the proxy's buffered path like on Windows.
fn create_main_window(app: &tauri::App) -> tauri::Result<()> {
    #[cfg(target_os = "linux")]
    use tauri::Manager;

    let user_agent = format!(
        "free-grind/{} (+https://github.com/fdev8974/free-grind)",
        app.package_info().version
    );

    #[cfg(target_os = "linux")]
    let extensions = app
        .path()
        .resource_dir()?
        .join(media_proxy::WEBKIT_EXTENSIONS);
    #[cfg(target_os = "linux")]
    let has_extension = std::fs::metadata(extensions.join("libfgmedia.so"))
        .is_ok_and(|meta| meta.len() > 0);
    #[cfg(target_os = "linux")]
    if has_extension {
        // WebKit only hands URI schemes on this list to GStreamer's own
        // sources; read by the web process, which starts with the window.
        let var = "WEBKIT_GST_ALLOWED_URI_PROTOCOLS";
        let allowed = std::env::var(var).unwrap_or_default();
        if !allowed.split(',').any(|entry| entry.trim() == media_proxy::SCHEME) {
            let joined = if allowed.trim().is_empty() {
                media_proxy::SCHEME.to_owned()
            } else {
                format!("{allowed},{}", media_proxy::SCHEME)
            };
            std::env::set_var(var, joined);
        }
    } else {
        eprintln!("[media] no video extension in {}, video is buffered", extensions.display());
    }

    let deferred: Vec<_> = app
        .config()
        .app
        .windows
        .iter()
        .filter(|window| !window.create)
        .cloned()
        .collect();
    for window in deferred {
        #[allow(unused_mut)]
        let mut builder = tauri::WebviewWindowBuilder::from_config(app.handle(), &window)?
            .user_agent(&user_agent);
        #[cfg(target_os = "linux")]
        if has_extension {
            builder = builder.extensions_path(&extensions);
        }
        #[allow(unused_variables)]
        let window = builder.build()?;
        #[cfg(target_os = "linux")]
        if has_extension {
            media_proxy::serve_element_opens(&window);
        }
    }
    Ok(())
}

/// Loads a persisted device identity + active session (if any) and builds the
/// initial `grindr::GrindrClient` synchronously (`GrindrClient::new` needs no
/// runtime), so it's guaranteed to exist — or a clear startup error is
/// logged — before the webview starts loading. The session-persistence and
/// websocket-bridge tasks it spawns run in the background from here on.
fn init_client(app: &tauri::AppHandle) {
    api::auth::SigningKeyStorage::forget_unscoped();
    let device = api::auth::DeviceStorage::load().ok().flatten();
    let session = api::auth::AuthStorage::get_session().ok().flatten();
    if let Err(e) = api::auth::adopt_client(app, device, session) {
        eprintln!("Warning: failed to initialize GrindrClient: {e}");
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(target_os = "windows")]
    {
        windows_instance::WindowsInstance::init();
    }

    // Keyring initialization should not block app startup.
    // Some environments (including certain Intel macOS setups) can fail keychain init.
    if let Err(e) = storage::init_keyring() {
        eprintln!(
            "Warning: keyring initialization failed (continuing without persisted sessions): {:?}",
            e
        );
    }

    // Platform-specific setup for plugins
    #[cfg(not(mobile))]
    {
        #[cfg(target_os = "windows")]
        let instance_lock_guard = match instance_lock::acquire_for_current_child_instance() {
            Ok(guard) => guard,
            Err(error) => {
                eprintln!("Free Grind failed to acquire child instance lock: {}", error);
                instance_lock::show_lock_error_dialog(&error);
                return;
            }
        };

        #[cfg(target_os = "windows")]
        let is_manager_runtime = windows_instance::WindowsInstance::current().is_manager();
        #[cfg(not(target_os = "windows"))]
        let is_manager_runtime = false;

        let context = tauri::generate_context!();
        let (hotswap, context) = if is_manager_runtime {
            (None, context)
        } else {
            match tauri_plugin_hotswap::init(context) {
                Ok((h, c)) => (Some(h), c),
                Err(e) => {
                    panic!("failed to initialize hotswap plugin: {}", e);
                }
            }
        };

        let mut builder = tauri::Builder::default();
        if let Some(hotswap_plugin) = hotswap {
            builder = builder.plugin(hotswap_plugin);
        }

        let app = builder
            .plugin(tauri_plugin_notification::init())
            .plugin(tauri_plugin_os::init())
            .plugin(tauri_plugin_geolocation::init())
            .plugin(tauri_plugin_fs::init())
            .plugin(tauri_plugin_http::init())
            .plugin(tauri_plugin_sql::Builder::default().build())
            .plugin(tauri_plugin_opener::init())
            .plugin(tauri_plugin_dialog::init())
            .plugin(api::facebook_oauth::plugin())
            .plugin(api::google_oauth::plugin())
            .manage(AppState::default())
            .manage(media_proxy::MediaProxy::default())
            .plugin(media_proxy_flag())
            .register_asynchronous_uri_scheme_protocol(media_proxy::SCHEME, media_proxy::handle)
            .setup(|app| {
                let app_handle = app.handle().clone();
                init_client(&app_handle);

                create_main_window(app)?;

                #[cfg(target_os = "linux")]
                {
                    use tauri::Manager;
                    use webkit2gtk::{PermissionRequestExt, SettingsExt, WebViewExt};
                    if let Some(win) = app.get_webview_window("main") {
                        let _ = win.with_webview(|webview| {
                            let view = webview.inner();
                            // WebKitGTK gates RTCPeerConnection/getUserMedia behind this
                            // flag on distros where it's actually compiled in. Harmless
                            // to set unconditionally, but not sufficient on its own —
                            // confirmed on Fedora 44's webkit2gtk4.1 (2.52.3) that
                            // RTCPeerConnection is undefined even with this enabled and
                            // even in GNOME Web (Epiphany, same engine), and even after
                            // forcing a full WebProcess respawn. That build appears to
                            // ship without the WebRTC DOM bindings at all, which no
                            // runtime setting from this app can work around — video
                            // calls are simply unsupported on such Linux builds.
                            if let Some(settings) = view.settings() {
                                settings.set_enable_webrtc(true);
                            }
                            view.connect_permission_request(|_view, request| {
                                request.allow();
                                true
                            });
                        });
                    }
                }

                // WebView2 (Chromium) has its own geolocation/microphone backends wired
                // to the Windows Location service and audio devices, but only
                // prompts/grants them if the host app handles PermissionRequested —
                // without this it silently denies navigator.geolocation and
                // navigator.mediaDevices.getUserMedia calls instead of showing the
                // OS prompt.
                #[cfg(target_os = "windows")]
                {
                    use tauri::Manager;
                    use webview2_com::Microsoft::Web::WebView2::Win32::{
                        COREWEBVIEW2_PERMISSION_KIND_CAMERA, COREWEBVIEW2_PERMISSION_KIND_GEOLOCATION,
                        COREWEBVIEW2_PERMISSION_KIND_MICROPHONE, COREWEBVIEW2_PERMISSION_STATE_ALLOW,
                    };
                    use webview2_com::PermissionRequestedEventHandler;
                    if let Some(win) = app.get_webview_window("main") {
                        let _ = win.with_webview(|webview| {
                            let Ok(core) = (unsafe { webview.controller().CoreWebView2() }) else {
                                return;
                            };
                            let mut token = Default::default();
                            unsafe {
                                let _ = core.add_PermissionRequested(
                                    &PermissionRequestedEventHandler::create(Box::new(
                                        |_sender, args| {
                                            let Some(args) = args else { return Ok(()) };
                                            let mut kind = Default::default();
                                            args.PermissionKind(&mut kind)?;
                                            if kind == COREWEBVIEW2_PERMISSION_KIND_GEOLOCATION
                                                || kind == COREWEBVIEW2_PERMISSION_KIND_MICROPHONE
                                                || kind == COREWEBVIEW2_PERMISSION_KIND_CAMERA
                                            {
                                                args.SetState(COREWEBVIEW2_PERMISSION_STATE_ALLOW)?;
                                            }
                                            Ok(())
                                        },
                                    )),
                                    &mut token,
                                );
                            }
                        });
                    }
                }
                Ok(())
            })
            .invoke_handler(tauri::generate_handler![
                api::runtime::runtime_context,
                api::runtime::webview_version,
                api::runtime::create_child_instance,
                api::runtime::list_child_instances,
                api::runtime::rename_child_instance,
                api::runtime::remove_child_instance,
                api::runtime::launch_child_instance,
                api::auth::login,
                api::auth::login_with_google,
                api::auth::login_with_facebook,
                api::auth::login_with_google_window,
                api::auth::sign_up_quota,
                api::auth::create_account,
                api::auth::forgot_password,
                api::auth::send_sms_verification_code,
                api::auth::verify_sms_verification_code,
                api::auth::recaptcha_first_party_enabled,
                api::auth::refresh_token,
                api::auth::logout,
                api::auth::auth_state,
                api::auth::account_restriction,
                api::auth::accept_ban_agreement,
                api::entitlements::enter_honduras,
                api::entitlements::leave_honduras,
                api::entitlements::restore_stranded_location,
                api::auth::websocket_token,
                api::auth::sync_push_token,
                api::auth::list_saved_accounts,
                api::auth::switch_account,
                api::auth::remove_saved_account,
                api::auth::create_transfer_code,
                api::auth::sign_in_with_transfer_code,
                api::rest::request,
                api::rest::fetch_external,
                media_proxy::media_failure,
                api::websocket::ws_connect,
                api::websocket::ws_send,
                api::websocket::ws_status,
                api::websocket::ws_reconnect,
                api::websocket::set_app_active,
                api::websocket::ws_log_event,
                commands::fingerprint::check_fingerprint,
                commands::backup::export_backup_to_file,
                commands::backup::import_backup_from_file,
                commands::backup::inspect_backup_file,
                commands::backup::copy_file_to_android_uri,
                commands::backup::copy_android_uri_to_file,
                commands::media_upload::upload_profile_image,
                commands::media_upload::upload_chat_media,
                commands::media_sanitize::sanitize_upload_media,
            ])
            .build(context)
            .expect("error while running tauri application");

        // On Windows, the desktop event loop terminates the process with
        // std::process::exit once the window closes and never returns control
        // to this function, so instance_lock_guard's Drop would otherwise
        // never run, leaving a stale instance.lock behind that blocks every
        // future launch of this child instance. RunEvent::Exit fires just
        // before that exit, so release the lock there instead.
        #[cfg(target_os = "windows")]
        {
            let mut instance_lock_guard = instance_lock_guard;
            app.run(move |_app_handle, event| {
                if let tauri::RunEvent::Exit = event {
                    instance_lock_guard.take();
                }
            });
        }
        #[cfg(not(target_os = "windows"))]
        {
            app.run(|_app_handle, _event| {});
        }
    }

    #[cfg(mobile)]
    {
        let context = tauri::generate_context!();
        let (hotswap, context) = match tauri_plugin_hotswap::init(context) {
            Ok((h, c)) => (h, c),
            Err(e) => {
                panic!("failed to initialize hotswap plugin: {}", e);
            }
        };

        let builder = tauri::Builder::default()
            .plugin(hotswap)
            .plugin(tauri_plugin_notification::init())
            .plugin(tauri_plugin_os::init())
            .plugin(tauri_plugin_geolocation::init())
            .plugin(tauri_plugin_fs::init())
            .plugin(tauri_plugin_http::init())
            .plugin(tauri_plugin_sql::Builder::default().build())
            .plugin(tauri_plugin_opener::init())
            .plugin(api::facebook_oauth::plugin())
            .plugin(api::google_oauth::plugin())
            .plugin(tauri_plugin_barcode_scanner::init());

        #[cfg(target_os = "ios")]
        let builder = builder
            .plugin(tauri_plugin_ios_photos::init())
            .plugin(tauri_plugin_dialog::init())
            .plugin(tauri_plugin_ios_keyboard_fix::init())
            .plugin(tauri_plugin_ios_app_disguise::init());

        #[cfg(target_os = "android")]
        let builder = builder
            .plugin(tauri_plugin_android_fs::init())
            .plugin(media::photo::plugin());

        builder
            .manage(AppState::default())
            .manage(media_proxy::MediaProxy::default())
            .plugin(media_proxy_flag())
            .register_asynchronous_uri_scheme_protocol(media_proxy::SCHEME, media_proxy::handle)
            .setup(|app| {
                use tauri::Manager;
                // Native binary version, which can lag behind an OTA-updated frontend.
                eprintln!("Free Grind binary {} starting", app.package_info().version);
                let app_handle = app.handle().clone();
                init_client(&app_handle);
                Ok(())
            })
            .invoke_handler(tauri::generate_handler![
                api::runtime::runtime_context,
                api::runtime::webview_version,
                api::runtime::create_child_instance,
                api::runtime::list_child_instances,
                api::runtime::rename_child_instance,
                api::runtime::remove_child_instance,
                api::runtime::launch_child_instance,
                api::auth::login,
                api::auth::login_with_google,
                api::auth::login_with_facebook,
                api::auth::login_with_google_window,
                api::auth::sign_up_quota,
                api::auth::create_account,
                api::auth::forgot_password,
                api::auth::send_sms_verification_code,
                api::auth::verify_sms_verification_code,
                api::auth::recaptcha_first_party_enabled,
                api::auth::refresh_token,
                api::auth::logout,
                api::auth::auth_state,
                api::auth::account_restriction,
                api::auth::accept_ban_agreement,
                api::entitlements::enter_honduras,
                api::entitlements::leave_honduras,
                api::entitlements::restore_stranded_location,
                api::auth::websocket_token,
                api::auth::sync_push_token,
                api::auth::list_saved_accounts,
                api::auth::switch_account,
                api::auth::remove_saved_account,
                api::auth::create_transfer_code,
                api::auth::sign_in_with_transfer_code,
                api::rest::request,
                api::rest::fetch_external,
                media_proxy::media_failure,
                api::websocket::ws_connect,
                api::websocket::ws_send,
                api::websocket::ws_status,
                api::websocket::ws_reconnect,
                api::websocket::set_app_active,
                api::websocket::ws_log_event,
                commands::fingerprint::check_fingerprint,
                commands::backup::export_backup_to_file,
                commands::backup::import_backup_from_file,
                commands::backup::inspect_backup_file,
                commands::backup::copy_file_to_android_uri,
                commands::backup::copy_android_uri_to_file,
                commands::media_upload::upload_profile_image,
                commands::media_upload::upload_chat_media,
                commands::media_sanitize::sanitize_upload_media,
            ])
            .run(context)
            .expect("error while running tauri application");
    }
}

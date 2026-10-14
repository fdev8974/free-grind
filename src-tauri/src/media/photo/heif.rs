//! image-rs can't read HEIF/HEIC. On Android the platform decoder
//! (`PhotoPlugin.kt`, API 28+) turns it into a downscaled sRGB PNG that the
//! regular pipeline then re-encodes; elsewhere it's refused with
//! `heic_unsupported`, which the frontend answers by letting the webview
//! decode it (WebKit on Apple platforms can) and retrying with a PNG.

use tauri::{AppHandle, Runtime};

use super::source::Source;
use crate::error::AppError;
#[cfg(not(target_os = "android"))]
use crate::media::{codes, media_error};

#[cfg(target_os = "android")]
pub use android::plugin;

pub async fn decode<R: Runtime>(app: &AppHandle<R>, bytes: Vec<u8>) -> Result<Source, AppError> {
    #[cfg(target_os = "android")]
    {
        android::decode(app, bytes).await
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, bytes);
        Err(media_error(codes::HEIC_UNSUPPORTED))
    }
}

#[cfg(target_os = "android")]
mod android {
    use base64::{engine::general_purpose::STANDARD, Engine as _};
    use serde::{Deserialize, Serialize};
    use tauri::plugin::{Builder, PluginHandle, TauriPlugin};
    use tauri::{AppHandle, Manager, Runtime};

    use super::super::encode::MAX_EDGE;
    use super::super::source::{self, Format, Source};
    use crate::error::AppError;
    use crate::media::{codes, media_error, off_thread};

    struct Decoder<R: Runtime> {
        handle: PluginHandle<R>,
    }

    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct DecodeRequest {
        data: String,
        max_edge: u32,
    }

    #[derive(Deserialize)]
    struct DecodeResponse {
        data: String,
    }

    pub fn plugin<R: Runtime>() -> TauriPlugin<R> {
        Builder::new("photo")
            .setup(|app, api| {
                let handle = api.register_android_plugin("dev.estopia.free_grind", "PhotoPlugin")?;
                app.manage(Decoder { handle });
                Ok(())
            })
            .build()
    }

    pub async fn decode<R: Runtime>(app: &AppHandle<R>, bytes: Vec<u8>) -> Result<Source, AppError> {
        let handle = app.state::<Decoder<R>>().handle.clone();
        let request = DecodeRequest {
            data: STANDARD.encode(&bytes),
            max_edge: MAX_EDGE,
        };
        let response: DecodeResponse = handle
            .run_mobile_plugin_async("decodeToPng", request)
            .await
            .map_err(|_| media_error(codes::HEIC_UNSUPPORTED))?;
        let png = STANDARD
            .decode(response.data)
            .map_err(|_| media_error(codes::UNREADABLE))?;

        off_thread(move || source::decode(Format::Png, &png))
            .await?
            .ok_or_else(|| media_error(codes::UNREADABLE))
    }
}

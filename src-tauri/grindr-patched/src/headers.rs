use wreq::header::{HeaderName, HeaderValue};

use crate::device::DeviceInfo;
use crate::error::GrindrError;

/// The Grindr Android app version this crate emulates.
///
/// Changing it is a breaking change (it can change how requests behave), so it
/// bumps the crate's breaking version too. The `+<apk>` suffix on the package
/// version mirrors this string but means nothing to Cargo on its own.
pub const APP_VERSION: &str = "26.20.0.187695";
pub(crate) const BUILD_NUMBER: &str = "187695";

const MEDIA_ACCEPT: &str = "image/webp,image/*;q=0.8";

/// Builds the `User-Agent` the app sends, e.g.
/// `grindr3/26.20.0.187695;187695;Free;Android 14;Pixel 8;Google`.
///
/// `subscription_tier` is usually `"Free"`.
pub fn build_user_agent(
	device: &DeviceInfo,
	subscription_tier: &str,
) -> String {
	format!(
		"grindr3/{APP_VERSION};{BUILD_NUMBER};{subscription_tier};{};{};{}",
		device.os, device.device_model, device.manufacturer
	)
}

/// `java.vm.version`, `2.1.0` on every current Android release.
const VM_VERSION: &str = "2.1.0";

/// Builds the `User-Agent` the platform's own HTTP stack sends, e.g.
/// `Dalvik/2.1.0 (Linux; U; Android 14; Pixel 8 Build/AP2A.240905.003)`.
///
/// Album video is played by `android.media.MediaPlayer`, which goes out over
/// `HttpURLConnection` and sends this instead of the app's `User-Agent`.
///
/// References <https://opengrind.org/grindr-api/media#cdn-request-headers>
pub fn build_platform_user_agent(device: &DeviceInfo) -> String {
	format!(
		"Dalvik/{VM_VERSION} (Linux; U; {}; {} Build/{})",
		device.os, device.device_model, device.build_id
	)
}

/// Builds the `L-Device-Info` header value from a [`DeviceInfo`].
pub fn build_device_info_header(device: &DeviceInfo) -> String {
	format!(
		"{};GLOBAL;{};{};{};{}",
		device.device_id,
		device.device_type,
		device.total_ram,
		device.screen_resolution,
		device.advertising_id
	)
}

/// References <https://opengrind.org/grindr-api/security-headers#correct-headers-order>
///   1. Authorization (optional)
///   2. L-Time-Zone
///   3. L-Grindr-Roles (only when authorized)
///   4. L-Device-Info
///   5. Accept
///   6. User-Agent
///   7. L-Locale
///   8. Accept-language (lowercase `l`)
///   9. Accept-Encoding (always `gzip`)
///
/// `Content-Type`, `Content-Length`/`Transfer-Encoding` and `Cookie` are added
/// by wreq itself. `Host` is moved to the `:authority` pseudo-header in HTTP/2.
pub struct GrindrHeaders {
	/// The header name/value pairs, in the exact order they must be sent.
	pub items: Vec<(HeaderName, HeaderValue)>,
}

impl GrindrHeaders {
	/// Build the header set for a request.
	pub fn build(
		device: &DeviceInfo,
		user_agent: &str,
		authorization: Option<&str>,
		l_grindr_roles: Option<&str>,
	) -> Result<Self, GrindrError> {
		let mut items: Vec<(HeaderName, HeaderValue)> = Vec::with_capacity(9);

		if let Some(auth) = authorization {
			items.push((
				HeaderName::from_static("authorization"),
				HeaderValue::from_str(auth).map_err(invalid_header)?,
			));
		}

		items.push((
			HeaderName::from_static("l-time-zone"),
			HeaderValue::from_str(&device.timezone).map_err(invalid_header)?,
		));

		if let Some(roles) = l_grindr_roles {
			items.push((
				HeaderName::from_static("l-grindr-roles"),
				HeaderValue::from_str(roles).map_err(invalid_header)?,
			));
		}

		items.push((
			HeaderName::from_static("l-device-info"),
			HeaderValue::from_str(&build_device_info_header(device))
				.map_err(invalid_header)?,
		));
		items.push((
			HeaderName::from_static("accept"),
			HeaderValue::from_static("application/json"),
		));
		items.push((
			HeaderName::from_static("user-agent"),
			HeaderValue::from_str(user_agent).map_err(invalid_header)?,
		));
		items.push((
			HeaderName::from_static("l-locale"),
			HeaderValue::from_static("en_US"),
		));
		items.push((
			HeaderName::from_static("accept-language"),
			HeaderValue::from_static("en-US"),
		));
		items.push((
			HeaderName::from_static("accept-encoding"),
			HeaderValue::from_static("gzip"),
		));

		Ok(Self { items })
	}

	/// Build the header set for a CDN media fetch: an image `Accept` and the
	/// same `User-Agent` the API sends. A ranged request drops `Accept-Encoding`.
	///
	/// References <https://opengrind.org/grindr-api/media#cdn-request-headers>
	pub fn build_media(
		user_agent: &str,
		range: Option<&str>,
	) -> Result<Self, GrindrError> {
		let mut items: Vec<(HeaderName, HeaderValue)> = Vec::with_capacity(3);

		items.push((
			HeaderName::from_static("accept"),
			HeaderValue::from_static(MEDIA_ACCEPT),
		));
		items.push((
			HeaderName::from_static("user-agent"),
			HeaderValue::from_str(user_agent).map_err(invalid_header)?,
		));
		Self::finish_media(items, range)
	}

	/// Build the header set `android.media.MediaPlayer` sends: the platform
	/// `User-Agent` and no `Accept` at all.
	///
	/// References <https://opengrind.org/grindr-api/media#cdn-request-headers>
	pub fn build_platform_media(
		device: &DeviceInfo,
		range: Option<&str>,
	) -> Result<Self, GrindrError> {
		let items = vec![(
			HeaderName::from_static("user-agent"),
			HeaderValue::from_str(&build_platform_user_agent(device))
				.map_err(invalid_header)?,
		)];
		Self::finish_media(items, range)
	}

	fn finish_media(
		mut items: Vec<(HeaderName, HeaderValue)>,
		range: Option<&str>,
	) -> Result<Self, GrindrError> {
		match range {
			Some(range) => items.push((
				HeaderName::from_static("range"),
				HeaderValue::from_str(range).map_err(invalid_header)?,
			)),
			None => items.push((
				HeaderName::from_static("accept-encoding"),
				HeaderValue::from_static("gzip"),
			)),
		}
		Ok(Self { items })
	}
}

fn invalid_header<E: std::fmt::Display>(e: E) -> GrindrError {
	GrindrError::Http(format!("invalid header value: {e}"))
}

#[cfg(test)]
mod tests {
	use super::*;

	fn test_device() -> DeviceInfo {
		DeviceInfo {
			device_type: 2,
			device_id: "device123".to_owned(),
			os: "Android 14".to_owned(),
			screen_resolution: "1080x2400".to_owned(),
			total_ram: "8026152960".to_owned(),
			advertising_id: "ad-id-123".to_owned(),
			device_model: "Pixel 8".to_owned(),
			manufacturer: "Google".to_owned(),
			timezone: "Europe/Madrid".to_owned(),
			locale: "en_US".to_owned(),
			accept_language: "en-US".to_owned(),
			build_id: "AP2A.240905.003".to_owned(),
		}
	}

	#[test]
	fn user_agent_format() {
		let device = test_device();
		let ua = build_user_agent(&device, "Free");
		assert_eq!(
            ua,
            format!("grindr3/{APP_VERSION};{BUILD_NUMBER};Free;Android 14;Pixel 8;Google")
        );
	}

	#[test]
	fn platform_user_agent_format() {
		assert_eq!(
			build_platform_user_agent(&test_device()),
			"Dalvik/2.1.0 (Linux; U; Android 14; Pixel 8 Build/AP2A.240905.003)"
		);
	}

	#[test]
	fn the_platform_user_agent_shares_the_device_with_the_app_one() {
		let device = DeviceInfo::generate();
		let app = build_user_agent(&device, "Free");
		let platform = build_platform_user_agent(&device);

		assert!(app.contains(&device.os) && platform.contains(&device.os));
		assert!(
			app.contains(&device.device_model)
				&& platform.contains(&device.device_model),
			"a device claiming two models across the two user agents is a tell"
		);
	}

	#[test]
	fn device_info_header_format() {
		let device = test_device();
		assert_eq!(
			build_device_info_header(&device),
			"device123;GLOBAL;2;8026152960;1080x2400;ad-id-123"
		);
	}

	#[test]
	fn headers_order_without_auth() {
		let device = test_device();
		let ua = build_user_agent(&device, "Free");
		let h = GrindrHeaders::build(&device, &ua, None, None).unwrap();
		let names: Vec<&str> =
			h.items.iter().map(|(n, _)| n.as_str()).collect();
		assert_eq!(
			names,
			&[
				"l-time-zone",
				"l-device-info",
				"accept",
				"user-agent",
				"l-locale",
				"accept-language",
				"accept-encoding",
			]
		);
	}

	#[test]
	fn headers_order_with_auth_and_roles() {
		let device = test_device();
		let ua = build_user_agent(&device, "Free");
		let h = GrindrHeaders::build(
			&device,
			&ua,
			Some("Grindr3 tok"),
			Some("[FREE]"),
		)
		.unwrap();
		let names: Vec<&str> =
			h.items.iter().map(|(n, _)| n.as_str()).collect();
		assert_eq!(names[0], "authorization");
		assert_eq!(names[1], "l-time-zone");
		assert_eq!(names[2], "l-grindr-roles");
		assert_eq!(names[3], "l-device-info");
	}
}

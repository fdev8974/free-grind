use serde::{Deserialize, Serialize};

struct DeviceProfile {
	manufacturer: &'static str,
	device_model: &'static str,
	screen_resolution: &'static str,
	total_ram: &'static str,
	builds: &'static [(u8, &'static str)],
}

const DEVICE_PROFILES: &[DeviceProfile] = &[
	// Google
	DeviceProfile {
		manufacturer: "Google",
		device_model: "Pixel 6",
		screen_resolution: "2400x1080",
		total_ram: "8026152960",
		builds: &[
			(12, "SQ1D.220205.004"),
			(13, "TQ3A.230901.001"),
			(14, "AP2A.240905.003.F1"),
			(15, "BP1A.250505.005"),
			(16, "CP1A.260405.005"),
		],
	},
	DeviceProfile {
		manufacturer: "Google",
		device_model: "Pixel 6 Pro",
		screen_resolution: "3120x1440",
		total_ram: "12017676288",
		builds: &[
			(12, "SQ1D.220205.004"),
			(13, "TQ3A.230901.001"),
			(14, "AP2A.240905.003.F1"),
			(15, "BP1A.250505.005"),
			(16, "CP1A.260405.005"),
		],
	},
	DeviceProfile {
		manufacturer: "Google",
		device_model: "Pixel 6a",
		screen_resolution: "2400x1080",
		total_ram: "5938152960",
		builds: &[
			(12, "SD2A.220601.004"),
			(13, "TQ3A.230805.001"),
			(14, "AP2A.240905.003.F1"),
			(15, "BP1A.250505.005"),
			(16, "CP1A.260405.005"),
		],
	},
	DeviceProfile {
		manufacturer: "Google",
		device_model: "Pixel 7",
		screen_resolution: "2400x1080",
		total_ram: "8026152960",
		builds: &[
			(13, "TQ3A.230901.001"),
			(14, "AP2A.240905.003"),
			(15, "BP1A.250505.005.B1"),
			(16, "CP1A.260405.005"),
		],
	},
	DeviceProfile {
		manufacturer: "Google",
		device_model: "Pixel 7 Pro",
		screen_resolution: "3120x1440",
		total_ram: "12017676288",
		builds: &[
			(13, "TQ3A.230901.001"),
			(14, "AP2A.240905.003"),
			(15, "BP1A.250505.005.B1"),
			(16, "CP1A.260405.005"),
		],
	},
	DeviceProfile {
		manufacturer: "Google",
		device_model: "Pixel 7a",
		screen_resolution: "2400x1080",
		total_ram: "8026152960",
		builds: &[
			(13, "TQ3A.230901.001"),
			(14, "AP2A.240905.003"),
			(15, "BP1A.250505.005.B1"),
			(16, "CP1A.260505.005"),
		],
	},
	DeviceProfile {
		manufacturer: "Google",
		device_model: "Pixel 8",
		screen_resolution: "2400x1080",
		total_ram: "8026152960",
		builds: &[
			(14, "AP2A.240905.003"),
			(15, "BP1A.250505.005.B1"),
			(16, "CP1A.260505.005"),
		],
	},
	DeviceProfile {
		manufacturer: "Google",
		device_model: "Pixel 8 Pro",
		screen_resolution: "2992x1344",
		total_ram: "12017676288",
		builds: &[
			(14, "AP2A.240905.003"),
			(15, "BP1A.250505.005.B1"),
			(16, "CP1A.260505.005"),
		],
	},
	DeviceProfile {
		manufacturer: "Google",
		device_model: "Pixel 8a",
		screen_resolution: "2400x1080",
		total_ram: "8026152960",
		builds: &[
			(14, "AP2A.240905.003.A1"),
			(15, "BP1A.250505.005.B1"),
			(16, "CP1A.260505.005"),
		],
	},
	DeviceProfile {
		manufacturer: "Google",
		device_model: "Pixel 9",
		screen_resolution: "2424x1080",
		total_ram: "12017676288",
		builds: &[
			(14, "AD1A.240905.004"),
			(15, "BP1A.250505.005"),
			(16, "CP1A.260505.005"),
		],
	},
	DeviceProfile {
		manufacturer: "Google",
		device_model: "Pixel 9 Pro",
		screen_resolution: "2856x1280",
		total_ram: "16065654784",
		builds: &[
			(14, "AD1A.240905.004"),
			(15, "BP1A.250505.005"),
			(16, "CP1A.260505.005"),
		],
	},
	DeviceProfile {
		manufacturer: "Google",
		device_model: "Pixel 9 Pro XL",
		screen_resolution: "2992x1344",
		total_ram: "16065654784",
		builds: &[
			(14, "AD1A.240905.004"),
			(15, "BP1A.250505.005"),
			(16, "CP1A.260505.005"),
		],
	},
	// samsung
	DeviceProfile {
		manufacturer: "samsung",
		device_model: "SM-S901B",
		screen_resolution: "2340x1080",
		total_ram: "8026152960",
		builds: &[
			(12, "SP1A.210812.016"),
			(13, "TP1A.220624.014"),
			(14, "UP1A.231005.007"),
			(15, "AP3A.240905.015.A2"),
			(16, "BP2A.250605.031.A3"),
		],
	},
	DeviceProfile {
		manufacturer: "samsung",
		device_model: "SM-S906B",
		screen_resolution: "2340x1080",
		total_ram: "8026152960",
		builds: &[
			(12, "SP1A.210812.016"),
			(13, "TP1A.220624.014"),
			(14, "UP1A.231005.007"),
			(15, "AP3A.240905.015.A2"),
			(16, "BP2A.250605.031.A3"),
		],
	},
	DeviceProfile {
		manufacturer: "samsung",
		device_model: "SM-S908B",
		screen_resolution: "3088x1440",
		total_ram: "12017676288",
		builds: &[
			(12, "SP1A.210812.016"),
			(13, "TP1A.220624.014"),
			(14, "UP1A.231005.007"),
			(15, "AP3A.240905.015.A2"),
			(16, "BP2A.250605.031.A3"),
		],
	},
	DeviceProfile {
		manufacturer: "samsung",
		device_model: "SM-S911B",
		screen_resolution: "2340x1080",
		total_ram: "8026152960",
		builds: &[
			(13, "TP1A.220624.014"),
			(14, "UP1A.231005.007"),
			(15, "AP3A.240905.015.A2"),
			(16, "BP2A.250605.031.A3"),
		],
	},
	DeviceProfile {
		manufacturer: "samsung",
		device_model: "SM-S916B",
		screen_resolution: "2340x1080",
		total_ram: "8026152960",
		builds: &[
			(13, "TP1A.220624.014"),
			(14, "UP1A.231005.007"),
			(15, "AP3A.240905.015.A2"),
			(16, "BP2A.250605.031.A3"),
		],
	},
	DeviceProfile {
		manufacturer: "samsung",
		device_model: "SM-S918B",
		screen_resolution: "3088x1440",
		total_ram: "12017676288",
		builds: &[
			(13, "TP1A.220624.014"),
			(14, "UP1A.231005.007"),
			(15, "AP3A.240905.015.A2"),
			(16, "BP2A.250605.031.A3"),
		],
	},
	DeviceProfile {
		manufacturer: "samsung",
		device_model: "SM-S921B",
		screen_resolution: "2340x1080",
		total_ram: "8026152960",
		builds: &[
			(14, "UP1A.231005.007"),
			(15, "AP3A.240905.015.A2"),
			(16, "BP2A.250605.031.A3"),
		],
	},
	DeviceProfile {
		manufacturer: "samsung",
		device_model: "SM-S926B",
		screen_resolution: "2340x1080",
		total_ram: "12017676288",
		builds: &[
			(14, "UP1A.231005.007"),
			(15, "AP3A.240905.015.A2"),
			(16, "BP2A.250605.031.A3"),
		],
	},
	DeviceProfile {
		manufacturer: "samsung",
		device_model: "SM-S928B",
		screen_resolution: "3120x1440",
		total_ram: "12017676288",
		builds: &[
			(14, "UP1A.231005.007"),
			(15, "AP3A.240905.015.A2"),
			(16, "BP2A.250605.031.A3"),
		],
	},
	DeviceProfile {
		manufacturer: "samsung",
		device_model: "SM-A546B",
		screen_resolution: "2340x1080",
		total_ram: "8026152960",
		builds: &[
			(13, "TP1A.220624.014"),
			(14, "UP1A.231005.007"),
			(15, "AP3A.240905.015.A2"),
			(16, "BP2A.250605.031.A3"),
		],
	},
	DeviceProfile {
		manufacturer: "samsung",
		device_model: "SM-A346B",
		screen_resolution: "2340x1080",
		total_ram: "8026152960",
		builds: &[
			(13, "TP1A.220624.014"),
			(14, "UP1A.231005.007"),
			(15, "AP3A.240905.015.A2"),
			(16, "BP2A.250605.031.A3"),
		],
	},
	DeviceProfile {
		manufacturer: "samsung",
		device_model: "SM-A145F",
		screen_resolution: "2408x1080",
		total_ram: "3852152832",
		builds: &[
			(13, "TP1A.220624.014"),
			(14, "UP1A.231005.007"),
			(15, "AP3A.240905.015.A2"),
		],
	},
	DeviceProfile {
		manufacturer: "samsung",
		device_model: "SM-F731B",
		screen_resolution: "2640x1080",
		total_ram: "8026152960",
		builds: &[
			(13, "TP1A.220624.014"),
			(14, "UP1A.231005.007"),
			(15, "AP3A.240905.015.A2"),
			(16, "BP2A.250605.031.A3"),
		],
	},
	DeviceProfile {
		manufacturer: "samsung",
		device_model: "SM-F946B",
		screen_resolution: "2176x1812",
		total_ram: "12017676288",
		builds: &[
			(13, "TP1A.220624.014"),
			(14, "UP1A.231005.007"),
			(15, "AP3A.240905.015.A2"),
			(16, "BP2A.250605.031.A3"),
		],
	},
	// Xiaomi
	DeviceProfile {
		manufacturer: "Xiaomi",
		device_model: "2201123G",
		screen_resolution: "2400x1080",
		total_ram: "8026152960",
		builds: &[
			(12, "SKQ1.211006.001"),
			(13, "TKQ1.220807.001"),
			(14, "UKQ1.230917.001"),
			(15, "AQ3A.241006.001"),
		],
	},
	DeviceProfile {
		manufacturer: "Xiaomi",
		device_model: "2211133G",
		screen_resolution: "2400x1080",
		total_ram: "8026152960",
		builds: &[
			(13, "TKQ1.220905.001"),
			(14, "UKQ1.230804.001"),
			(15, "AQ3A.240912.001"),
			(16, "BP2A.250605.031.A3"),
		],
	},
	DeviceProfile {
		manufacturer: "Xiaomi",
		device_model: "23078PND5G",
		screen_resolution: "2712x1220",
		total_ram: "8026152960",
		builds: &[(13, "TP1A.220624.014"), (14, "UP1A.230905.011")],
	},
	DeviceProfile {
		manufacturer: "Xiaomi",
		device_model: "23127PN0CG",
		screen_resolution: "2670x1200",
		total_ram: "12017676288",
		builds: &[
			(14, "UKQ1.230804.001"),
			(15, "AQ3A.240627.003"),
			(16, "BP2A.250605.031.A3"),
		],
	},
	DeviceProfile {
		manufacturer: "Xiaomi",
		device_model: "23021RAA2Y",
		screen_resolution: "2400x1080",
		total_ram: "3852152832",
		builds: &[
			(13, "TKQ1.221114.001"),
			(14, "UKQ1.230917.001"),
			(15, "AQ3A.240829.003"),
		],
	},
	DeviceProfile {
		manufacturer: "Xiaomi",
		device_model: "23117RA68G",
		screen_resolution: "2712x1220",
		total_ram: "8026152960",
		builds: &[
			(13, "TP1A.220624.014"),
			(14, "UP1A.231005.007"),
			(15, "AP3A.240905.015.A2"),
		],
	},
	DeviceProfile {
		manufacturer: "Xiaomi",
		device_model: "23049PCD8G",
		screen_resolution: "2400x1080",
		total_ram: "8026152960",
		builds: &[(13, "TKQ1.221114.001"), (14, "UKQ1.230804.001")],
	},
	// motorola
	DeviceProfile {
		manufacturer: "motorola",
		device_model: "motorola edge 40",
		screen_resolution: "2400x1080",
		total_ram: "8026152960",
		builds: &[(13, "T2TL33.3-41-2")],
	},
	DeviceProfile {
		manufacturer: "motorola",
		device_model: "moto g84 5G",
		screen_resolution: "2400x1080",
		total_ram: "8026152960",
		builds: &[
			(13, "T3TC33.18-12-3"),
			(14, "U1TC34.22-64-6"),
			(15, "V1TC35H.88-16"),
		],
	},
	// Nothing
	DeviceProfile {
		manufacturer: "Nothing",
		device_model: "A065",
		screen_resolution: "2412x1080",
		total_ram: "12017676288",
		builds: &[
			(13, "TKQ1.221220.001"),
			(14, "UP1A.231005.007"),
			(15, "AQ3A.240912.001"),
		],
	},
	DeviceProfile {
		manufacturer: "Nothing",
		device_model: "A142",
		screen_resolution: "2412x1080",
		total_ram: "8026152960",
		builds: &[(14, "UP1A.231005.007"), (15, "AP3A.240617.008")],
	},
];

pub(crate) const SAFE_TIMEZONES: &[&str] = &[
	// Europe
	"Europe/Dublin",
	"Europe/Zurich",
	"Europe/Prague",
	"Europe/Bratislava",
	"Europe/Budapest",
	"Europe/Bucharest",
	"Europe/Sofia",
	"Europe/Zagreb",
	"Europe/Vilnius",
	"Europe/Riga",
	"Europe/Tallinn",
	"Europe/Luxembourg",
	"Europe/Malta",
	// Americas
	"America/Mexico_City",
	"America/Argentina/Buenos_Aires",
	"America/Santiago",
	"America/Bogota",
	"America/Lima",
	"America/Montevideo",
	// Asia-Pacific
	"Asia/Tokyo",
	"Asia/Taipei",
	"Asia/Seoul",
	"Asia/Bangkok",
	"Asia/Manila",
	"Asia/Singapore",
];

/// A fake Android device identity used to fill in request headers.
///
/// [`DeviceInfo::generate`] (or [`Default`]) picks a real hardware profile and
/// builds a believable device from it. Save it next to the
/// [`Session`](crate::Session) and reuse it — keeping the same device across
/// runs is less likely to trip Cloudflare than making a new one every time.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[non_exhaustive]
pub struct DeviceInfo {
	/// Device type sent to the API (`2` = Android).
	pub device_type: u8,
	/// 16-hex-character device identifier.
	pub device_id: String,
	/// OS string, e.g. `"Android 14"`.
	pub os: String,
	/// Screen resolution as `"<height>x<width>"`.
	pub screen_resolution: String,
	/// Total RAM in bytes, as a string.
	pub total_ram: String,
	/// Advertising id (a random UUID).
	pub advertising_id: String,
	/// Marketing/model code, e.g. `"Pixel 8"` or `"SM-S921B"`.
	pub device_model: String,
	/// Device manufacturer, e.g. `"Google"` or `"samsung"`.
	pub manufacturer: String,
	/// IANA timezone name sent in the `L-Time-Zone` header.
	pub timezone: String,
	/// Locale string, e.g. `"en_US"`.
	pub locale: String,
	/// `Accept-Language` value, e.g. `"en-US"`.
	pub accept_language: String,
	/// Build fingerprint id, e.g. `"TQ3A.230901.001"`.
	#[serde(default)]
	pub build_id: String,
}

impl DeviceInfo {
	/// Builds a random device: a real hardware profile, an Android version that
	/// fits it, and a safe timezone.
	pub fn generate() -> Self {
		let profile =
			&DEVICE_PROFILES[rand::random_range(0..DEVICE_PROFILES.len())];
		let timezone =
			SAFE_TIMEZONES[rand::random_range(0..SAFE_TIMEZONES.len())];
		let device_id = format!("{:016x}", rand::random::<u64>());
		let (android_version, build_id) =
			profile.builds[rand::random_range(0..profile.builds.len())];

		Self {
			device_type: 2,
			device_id,
			os: format!("Android {android_version}"),
			screen_resolution: profile.screen_resolution.to_owned(),
			total_ram: profile.total_ram.to_owned(),
			advertising_id: uuid::Uuid::new_v4().to_string(),
			device_model: profile.device_model.to_owned(),
			manufacturer: profile.manufacturer.to_owned(),
			timezone: timezone.to_owned(),
			locale: "en_US".to_owned(),
			accept_language: "en-US".to_owned(),
			build_id: build_id.to_owned(),
		}
	}
}

impl Default for DeviceInfo {
	fn default() -> Self {
		Self::generate()
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn generate_is_valid() {
		let d = DeviceInfo::generate();
		assert!(d.os.starts_with("Android "));
		assert_eq!(d.device_id.len(), 16);
		assert!(!d.device_model.is_empty());
	}

	#[test]
	fn every_profile_offers_at_least_one_real_build() {
		for p in DEVICE_PROFILES {
			assert!(
				!p.builds.is_empty(),
				"{} has no build ids, so it cannot produce a platform user agent",
				p.device_model,
			);
			for (version, build_id) in p.builds {
				assert!(
					(12..=16).contains(version),
					"{} lists android {version}",
					p.device_model,
				);
				assert!(
					!build_id.is_empty(),
					"{} has an empty build id for android {version}",
					p.device_model,
				);
			}
		}
	}

	#[test]
	fn a_generated_device_always_carries_its_build_id() {
		for _ in 0..200 {
			let d = DeviceInfo::generate();
			let profile = DEVICE_PROFILES
				.iter()
				.find(|p| p.device_model == d.device_model)
				.expect("generated model is a known profile");
			let version: u8 =
				d.os.trim_start_matches("Android ")
					.parse()
					.expect("os is `Android <major>`");
			assert!(
				profile.builds.contains(&(version, d.build_id.as_str())),
				"{} android {version} build {} is not a listed pair",
				d.device_model,
				d.build_id,
			);
		}
	}
}

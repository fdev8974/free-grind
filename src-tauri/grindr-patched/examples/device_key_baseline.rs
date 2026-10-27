use std::future::Future;
use std::path::{Path, PathBuf};
use std::pin::Pin;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use grindr::{
	CaptchaAction, CaptchaTokenProvider, DeviceInfo, GrindrClient, Method,
};

const DEVICE_KEY_FLAG: &str = "recaptcha_device_key_registration";

struct FixedToken(String);

impl CaptchaTokenProvider for FixedToken {
	fn token(
		&self,
		action: CaptchaAction,
	) -> Pin<Box<dyn Future<Output = Option<String>> + Send + '_>> {
		let token = (action == CaptchaAction::DeviceKeyRegistration)
			.then(|| self.0.clone());
		Box::pin(async move { token })
	}
}

fn load_or_create_device(path: &Path) -> DeviceInfo {
	if let Ok(json) = std::fs::read_to_string(path) {
		return serde_json::from_str(&json).expect("parse device file");
	}
	let device = DeviceInfo::generate();
	if let Some(parent) = path.parent() {
		std::fs::create_dir_all(parent).expect("create device file directory");
	}
	let json = serde_json::to_string_pretty(&device).expect("serialize device");
	std::fs::write(path, json).expect("write device file");
	device
}

async fn print_captcha_assignments(client: &GrindrClient) {
	let response = client
		.request(Method::GET, "/public/v1/assignments")
		.unauthenticated()
		.send()
		.await
		.expect("fetch assignments");
	let body: serde_json::Value =
		serde_json::from_slice(&response.body).unwrap_or_default();
	let assignments =
		body["assignments"].as_array().cloned().unwrap_or_default();

	println!("assignments status={}", response.status);
	for assignment in &assignments {
		let key = assignment["key"].as_str().unwrap_or_default();
		if key.contains("recaptcha") || key.contains("sift") {
			let value = assignment["value"].as_str().unwrap_or_default();
			println!("  {key}={value}");
		}
	}
	if !assignments.iter().any(|a| a["key"] == DEVICE_KEY_FLAG) {
		println!("  {DEVICE_KEY_FLAG}=<absent>");
	}
}

#[tokio::main(flavor = "current_thread")]
async fn main() {
	let email = std::env::var("EMAIL").expect("set EMAIL");
	let password = std::env::var("PASSWORD").expect("set PASSWORD");
	let device_file = std::env::var_os("DEVICE_FILE")
		.map(PathBuf::from)
		.unwrap_or_else(|| PathBuf::from("target/device_key_baseline.json"));
	let captcha_token = std::env::var("CAPTCHA_TOKEN")
		.ok()
		.filter(|t| !t.is_empty());

	let device = load_or_create_device(&device_file);
	println!(
		"device {} ({} {}) from {}",
		device.device_id,
		device.manufacturer,
		device.device_model,
		device_file.display()
	);

	let client = GrindrClient::new(device, None).expect("build client");
	print_captcha_assignments(&client).await;

	let sign_in = client
		.sign_in_with_email(&email, &password)
		.await
		.expect("sign in");
	println!("signed in profile_id={:?}", sign_in.profile_id);

	let path = match captcha_token {
		Some(token) => {
			println!("captcha token len={}", token.len());
			client.set_captcha_provider(Arc::new(FixedToken(token)));
			"/v2/verification/device-keys"
		}
		None => "/v1/verification/device-keys",
	};

	let at_epoch_ms = SystemTime::now()
		.duration_since(UNIX_EPOCH)
		.expect("clock after epoch")
		.as_millis();
	let result = client.register_device_key().await;
	println!("registration {path} at_epoch_ms={at_epoch_ms}");
	match result {
		Ok(()) => println!("VERDICT: REGISTERED"),
		Err(error)
			if format!("{error:?}").contains("device_key_captcha_rejected") =>
		{
			println!("VERDICT: CAPTCHA_REJECTED {error:?}")
		}
		Err(error) => println!("VERDICT: FAILED {error:?}"),
	}
}

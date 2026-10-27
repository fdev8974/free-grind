use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use bytes::Bytes;
use p256::ecdsa::signature::Verifier;
use p256::ecdsa::{DerSignature, VerifyingKey};
use sha2::{Digest, Sha256};
use spki::DecodePublicKey;

use crate::signing::DeviceKey;
use crate::testserver::{self, FixedCaptcha, Recorded, ACCEPTING_PATH};
use crate::{DeviceInfo, DeviceSigningKey, GrindrClient, Method};

const VARYING_HEADERS: [&str; 9] = [
	"authorization",
	"host",
	"l-device-info",
	"l-time-zone",
	"user-agent",
	"x-key-id",
	"x-nonce",
	"x-sig",
	"x-timestamp",
];

const KEY_REGISTRATIONS: [&str; 2] = [
	"/v1/verification/device-keys",
	"/v2/verification/device-keys",
];

fn render(requests: &[Recorded]) -> String {
	let mut rendered = String::new();
	for request in requests {
		let registration = KEY_REGISTRATIONS.contains(&request.path.as_str());
		rendered.push_str(&format!("{} {}\n", request.method, request.path));
		for (name, value) in &request.headers {
			let varies = VARYING_HEADERS.contains(&name.as_str())
				|| (registration && name == "content-length");
			let value = if varies { "<varies>" } else { value };
			rendered.push_str(&format!("\t{name}: {value}\n"));
		}
		let body = if registration {
			"<varies>"
		} else {
			&request.body
		};
		rendered.push_str(format!("\tbody: {body}").trim_end());
		rendered.push('\n');
	}
	rendered
}

struct SignedBy<'a> {
	key: &'a DeviceSigningKey,
	device_id: &'a str,
}

fn assert_signed(request: &Recorded, signer: SignedBy) {
	let key = DeviceKey::from_stored(signer.key).unwrap();
	let header = |name| request.header(name).unwrap();
	let timestamp: u128 = header("x-timestamp").parse().unwrap();
	let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap();
	assert!(now.as_millis().abs_diff(timestamp) < 60_000, "{timestamp}");
	assert_eq!(header("x-key-id"), key.key_id());

	let verifying = VerifyingKey::from(
		p256::PublicKey::from_public_key_der(
			&URL_SAFE_NO_PAD.decode(key.public_key()).unwrap(),
		)
		.unwrap(),
	);
	let der = URL_SAFE_NO_PAD.decode(header("x-sig")).unwrap();
	let signature = DerSignature::try_from(der.as_slice()).unwrap();
	let message = format!(
		"{}|{timestamp}|{}|{}|{}",
		URL_SAFE_NO_PAD.encode(Sha256::digest(request.body.as_bytes())),
		key.user_id(),
		signer.device_id,
		header("x-nonce"),
	);
	assert!(verifying.verify(message.as_bytes(), &signature).is_ok());
}

#[tokio::test]
async fn every_request_kind_keeps_its_wire_layout() {
	let device = DeviceInfo::generate();
	let device_id = device.device_id.clone();
	let client = GrindrClient::new(device, None).unwrap();
	let json = serde_json::json!({ "zeta": 1, "alpha": [2, 3] });

	client.recaptcha_first_party_enabled().await.ok();
	client.sign_in_with_email("a@b.c", "pw").await.unwrap();
	client
		.request(Method::GET, ACCEPTING_PATH)
		.unauthenticated()
		.send()
		.await
		.unwrap();
	client
		.request(Method::POST, ACCEPTING_PATH)
		.unauthenticated()
		.json(&json)
		.send()
		.await
		.unwrap();
	client
		.request(Method::GET, ACCEPTING_PATH)
		.send()
		.await
		.unwrap();
	client
		.request(Method::PUT, ACCEPTING_PATH)
		.json(&json)
		.send()
		.await
		.unwrap();
	client
		.request(Method::POST, ACCEPTING_PATH)
		.bytes("image/jpeg", Bytes::from_static(b"bytes"))
		.send()
		.await
		.unwrap();
	client
		.request(Method::POST, ACCEPTING_PATH)
		.signed_bytes("image/jpeg", Bytes::from_static(b"signed"))
		.send()
		.await
		.unwrap();

	let captcha_device = DeviceInfo::generate();
	let captcha_device_id = captcha_device.device_id.clone();
	let captcha_client = GrindrClient::new(captcha_device, None).unwrap();
	captcha_client.set_captcha_provider(Arc::new(FixedCaptcha));
	captcha_client
		.sign_in_with_email("a@b.c", "pw")
		.await
		.unwrap();
	captcha_client.register_device_key().await.unwrap();

	let mut requests = testserver::requests_from(&device_id);
	let key = client.signing_key_receiver().borrow().clone().unwrap();
	let signed: Vec<_> = requests
		.iter()
		.filter(|r| r.header("x-sig").is_some())
		.collect();
	let [signed] = signed[..] else {
		panic!("expected one signed request");
	};
	assert_signed(
		signed,
		SignedBy {
			key: &key,
			device_id: &device_id,
		},
	);
	requests.extend(testserver::requests_from(&captcha_device_id));
	assert_eq!(render(&requests), include_str!("wire_tests/requests.txt"));
}

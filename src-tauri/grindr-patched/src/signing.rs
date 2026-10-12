use std::fmt;

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use p256::ecdsa::{signature::Signer, Signature, SigningKey};
use rand_core::{OsRng, RngCore};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use spki::EncodePublicKey;

fn b64url(bytes: impl AsRef<[u8]>) -> String {
	URL_SAFE_NO_PAD.encode(bytes)
}

/// A P-256 signing key registered for one account, held for the session.
pub(crate) struct DeviceKey {
	key: SigningKey,
	key_id: String,
	public_key: String,
	user_id: String,
}

impl DeviceKey {
	pub fn generate(user_id: String) -> Self {
		Self::from_key(
			SigningKey::from(&p256::SecretKey::random(&mut OsRng)),
			user_id,
		)
	}

	pub fn from_stored(stored: &DeviceSigningKey) -> Option<Self> {
		let bytes = URL_SAFE_NO_PAD.decode(&stored.key).ok()?;
		if bytes.len() != 32 {
			return None;
		}
		let key = SigningKey::from_bytes(p256::FieldBytes::from_slice(&bytes))
			.ok()?;
		Some(Self::from_key(key, stored.user_id.clone()))
	}

	fn from_key(key: SigningKey, user_id: String) -> Self {
		let spki = p256::PublicKey::from(key.verifying_key())
			.to_public_key_der()
			.expect("P-256 public keys always encode to SPKI")
			.into_vec();
		Self {
			key_id: b64url(Sha256::digest(&spki)),
			public_key: b64url(&spki),
			key,
			user_id,
		}
	}

	pub fn key_id(&self) -> &str {
		&self.key_id
	}

	pub fn public_key(&self) -> &str {
		&self.public_key
	}

	pub fn user_id(&self) -> &str {
		&self.user_id
	}

	pub fn export(&self) -> DeviceSigningKey {
		DeviceSigningKey {
			key: b64url(self.key.to_bytes()),
			user_id: self.user_id.clone(),
		}
	}

	fn sign(&self, message: &str) -> String {
		let signature: Signature = self.key.sign(message.as_bytes());
		b64url(signature.to_der().as_bytes())
	}

	pub fn registration_signature(
		&self,
		android_id: &str,
		challenge: &str,
	) -> String {
		self.sign(&format!(
			"{}|{}|{}|{android_id}|{challenge}",
			self.user_id, self.key_id, self.public_key
		))
	}

	pub fn upload_headers(
		&self,
		android_id: &str,
		body: &[u8],
		timestamp: u64,
	) -> UploadSignature {
		let mut nonce = [0u8; 32];
		OsRng.fill_bytes(&mut nonce);
		let nonce = b64url(nonce);
		let body_hash = b64url(Sha256::digest(body));
		let signature = self.sign(&format!(
			"{body_hash}|{timestamp}|{}|{android_id}|{nonce}",
			self.user_id
		));
		UploadSignature {
			key_id: self.key_id.clone(),
			signature,
			timestamp,
			nonce,
		}
	}
}

pub(crate) struct UploadSignature {
	pub key_id: String,
	pub signature: String,
	pub timestamp: u64,
	pub nonce: String,
}

/// A device signing key for one account and device; `Debug` redacts it.
#[derive(Clone, Serialize, Deserialize)]
pub struct DeviceSigningKey {
	key: String,
	user_id: String,
}

impl DeviceSigningKey {
	/// Profile id this key was registered for.
	pub fn user_id(&self) -> &str {
		&self.user_id
	}
}

impl fmt::Debug for DeviceSigningKey {
	fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
		f.debug_struct("DeviceSigningKey")
			.field("key", &"<redacted>")
			.field("user_id", &self.user_id)
			.finish()
	}
}

#[derive(Serialize)]
pub(crate) struct RegisterKeyRequest<'a> {
	#[serde(rename = "publicKey")]
	pub public_key: &'a str,
	#[serde(rename = "keyId")]
	pub key_id: &'a str,
	#[serde(rename = "registrationSignature")]
	pub registration_signature: &'a str,
}

#[derive(Deserialize)]
pub(crate) struct ChallengeResponse {
	pub challenge: String,
}

pub(crate) enum SigningReject {
	Retryable,
	Fatal,
}

pub(crate) fn signing_reject(body: &[u8]) -> Option<SigningReject> {
	#[derive(Deserialize)]
	struct Body {
		#[serde(rename = "type")]
		kind: Option<String>,
	}
	let kind = serde_json::from_slice::<Body>(body).ok()?.kind?;
	if kind.contains("timestamp_drift") || kind.contains("nonce_replayed") {
		Some(SigningReject::Retryable)
	} else {
		Some(SigningReject::Fatal)
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn key_id_is_sha256_of_public_key() {
		let key = DeviceKey::generate("1".into());
		let spki = URL_SAFE_NO_PAD.decode(key.public_key()).unwrap();
		assert_eq!(key.key_id(), b64url(Sha256::digest(&spki)));
	}

	#[test]
	fn debug_does_not_leak_the_private_key() {
		let exported = DeviceKey::generate("42".to_owned()).export();
		let rendered = format!("{exported:?}");

		assert!(!rendered.contains(&exported.key), "got {rendered}");
		assert!(rendered.contains("<redacted>"), "got {rendered}");
		assert!(rendered.contains("42"), "got {rendered}");
	}

	#[test]
	fn export_round_trips_the_key() {
		let key = DeviceKey::generate("42".into());
		let restored = DeviceKey::from_stored(&key.export()).unwrap();
		assert_eq!(restored.key_id(), key.key_id());
		assert_eq!(restored.public_key(), key.public_key());
		assert_eq!(restored.user_id(), "42");
	}

	#[test]
	fn signatures_are_url_safe_unpadded_base64() {
		let key = DeviceKey::generate("123".into());
		let sig = key.registration_signature("abcdef0123456789", "chal");
		assert!(!sig.contains('=') && !sig.contains('+') && !sig.contains('/'));
		assert!(URL_SAFE_NO_PAD.decode(&sig).is_ok());
	}

	#[test]
	fn upload_signature_verifies_over_the_canonical_message() {
		use p256::ecdsa::{signature::Verifier, DerSignature, VerifyingKey};

		let key = DeviceKey::generate("42".into());
		let body = b"jpeg-bytes";
		let headers =
			key.upload_headers("0011223344556677", body, 1_700_000_000_000);

		let body_hash = b64url(Sha256::digest(body));
		let message = format!(
			"{body_hash}|{}|42|0011223344556677|{}",
			headers.timestamp, headers.nonce
		);
		let verifying = VerifyingKey::from(&key.key);
		let der = URL_SAFE_NO_PAD.decode(&headers.signature).unwrap();
		let signature = DerSignature::try_from(der.as_slice()).unwrap();
		assert!(verifying.verify(message.as_bytes(), &signature).is_ok());
	}

	#[test]
	fn detects_retryable_and_fatal_rejections() {
		assert!(matches!(
            signing_reject(br#"{"type":"timestamp_drift","detail":"2026-01-01T00:00:00Z"}"#),
            Some(SigningReject::Retryable)
        ));
		assert!(matches!(
			signing_reject(br#"{"type":"nonce_replayed"}"#),
			Some(SigningReject::Retryable)
		));
		assert!(matches!(
			signing_reject(br#"{"type":"invalid_key"}"#),
			Some(SigningReject::Fatal)
		));
		assert!(
			signing_reject(br#"{"code":4,"message":"Media not allowed"}"#)
				.is_none()
		);
	}
}

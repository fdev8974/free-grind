use std::future::Future;
use std::pin::Pin;

/// A reCAPTCHA Enterprise action, named as the token request scores it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CaptchaAction {
	/// Registering a device signing key (`POST /v2/verification/device-keys`).
	DeviceKeyRegistration,
	/// Submitting a moderation appeal (`POST /v2/decision-appeal`).
	DecisionAppeal,
}

impl CaptchaAction {
	/// The action string the reCAPTCHA assessment is scored against.
	pub fn as_str(self) -> &'static str {
		match self {
			CaptchaAction::DeviceKeyRegistration => "device_key_registration",
			CaptchaAction::DecisionAppeal => "decision_appeal",
		}
	}
}

/// `X-Grindr-Captcha-Token` supplier.
///
/// Register reCAPTCHA token with
/// [`GrindrClient::set_captcha_provider`](crate::GrindrClient::set_captcha_provider).
pub trait CaptchaTokenProvider: Send + Sync {
	/// Returns a fresh token for `action`, or `None` to fall back to the
	/// endpoint variant that carries no token.
	fn token(
		&self,
		action: CaptchaAction,
	) -> Pin<Box<dyn Future<Output = Option<String>> + Send + '_>>;
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn action_strings_match_the_wire() {
		assert_eq!(
			CaptchaAction::DeviceKeyRegistration.as_str(),
			"device_key_registration"
		);
		assert_eq!(CaptchaAction::DecisionAppeal.as_str(), "decision_appeal");
	}
}

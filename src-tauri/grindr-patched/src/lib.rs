//! Unofficial async Rust client for the Grindr API, powering the
//! [Open Grind](https://opengrind.org) client.
//!
//! It talks to Grindr the same way the official Android app does: same TLS and
//! HTTP/2 fingerprint, same header order, same device identity. On top of that
//! it handles sign-in, session refresh, requests, and the realtime websocket.
//!
//! It's only a transport — it doesn't ship types for individual endpoints. You
//! pick the path and deserialize the response body yourself.
//!
//! # Overview
//!
//! - [`GrindrClient`] — the main entry point. Cheap to clone, refreshes the
//!   token on its own, and runs the realtime websocket in the background once
//!   you opt in with [`GrindrClient::connect`].
//! - [`DeviceInfo`] — a fake but believable device identity.
//! - [`Session`] — credentials you can save and resume from.
//! - [`RawResponse`] — the status and body from a request.
//! - [`WsEvent`] / [`WsCommand`] — incoming and outgoing realtime messages.
//!
//! # Example
//!
//! ```no_run
//! use grindr::{DeviceInfo, GrindrClient, Method};
//!
//! # async fn run() -> Result<(), grindr::GrindrError> {
//! // Make a device identity once, save it, and reuse it next time.
//! let client = GrindrClient::new(DeviceInfo::generate(), None)?;
//!
//! client.sign_in_with_email("user@example.com", "hunter2").await?;
//!
//! // Make a request — the session token is added for you.
//! let resp = client.request(Method::GET, "/v3/me/profile").send().await?;
//! println!("status = {}", resp.status);
//! # Ok(())
//! # }
//! ```
//!
//! # Disclaimer
//!
//! This is an unofficial library, not affiliated with or endorsed by Grindr.
//! It is provided for research and interoperability. Automating access may
//! violate Grindr's Terms of Service; you are responsible for how you use it.
#![forbid(unsafe_code)]
#![warn(missing_docs)]

mod auth;
mod captcha;
mod client;
mod device;
mod error;
mod headers;
mod media;
mod request;
mod rest;
mod signing;
mod stream;
#[cfg(test)]
mod testserver;
#[cfg(test)]
mod wire_tests;
mod ws;

pub use auth::{
	AuthEvent, BanDetails, Credentials, NewEmailAccount, RefreshFailureKind,
	Restriction, Session, SessionKind, SessionToken, SignInResult,
	SmsCodeResponse, SmsExchange, VerificationRegion,
};
pub use captcha::{CaptchaAction, CaptchaTokenProvider};
pub use client::{probe_emulation, GrindrClient};
pub use device::DeviceInfo;
pub use error::{BanInfo, BanKind, BlockKind, GrindrError, TimeoutPhase};
pub use headers::{
	build_device_info_header, build_platform_user_agent, build_user_agent,
	GrindrHeaders, APP_VERSION,
};
pub use media::{
	MediaFetcher, MediaRequest, MediaResponse, MediaStream, StreamRequest,
};
pub use request::RequestBuilder;
pub use rest::RawResponse;
pub use signing::DeviceSigningKey;
pub use stream::BodySource;
pub use ws::{WsCommand, WsConnectionState, WsEvent};

/// Request body bytes, re-exported from [`bytes`].
pub use bytes::Bytes;
/// HTTP method, re-exported from [`wreq`].
pub use wreq::Method;

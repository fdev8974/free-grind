use std::sync::{Arc, Mutex, Once};
use std::time::Duration;

use tokio::sync::{broadcast, mpsc, watch};
use wreq::{
	header::HeaderName, Client, EmulationProvider, Http1Config, Http2Config,
	Method, PseudoOrder, SettingsOrder, SslCurve, TlsConfig, TlsVersion,
};

use crate::auth::{AuthEvent, AuthState, Session, SessionKind, SignInResult};
use crate::device::DeviceInfo;
use crate::error::GrindrError;
use crate::headers::build_user_agent;
use crate::media::{
	CountConnections, MediaLiveness, MediaRequest, MediaResponse, MediaStream,
	StreamRequest, MEDIA_BODY_TIMEOUT, MEDIA_TIMEOUT,
};
use crate::request::RequestBuilder;
use crate::rest::{Fingerprint, InnerClient};
use crate::signing::DeviceSigningKey;
use crate::ws::{
	make_channels, WsChannels, WsCommand, WsConnectionState, WsEvent,
};

/// References <https://opengrind.org/grindr-api/security-headers#cipher-suites>
const MODERN_TLS_CIPHERS: &str = concat!(
	"TLS_AES_128_GCM_SHA256",
	":TLS_AES_256_GCM_SHA384",
	":TLS_CHACHA20_POLY1305_SHA256",
	":TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256",
	":TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256",
	":TLS_ECDHE_ECDSA_WITH_AES_256_GCM_SHA384",
	":TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384",
	":TLS_ECDHE_ECDSA_WITH_CHACHA20_POLY1305_SHA256",
	":TLS_ECDHE_RSA_WITH_CHACHA20_POLY1305_SHA256",
	":TLS_ECDHE_RSA_WITH_AES_128_CBC_SHA",
	":TLS_ECDHE_RSA_WITH_AES_256_CBC_SHA",
	":TLS_RSA_WITH_AES_128_GCM_SHA256",
	":TLS_RSA_WITH_AES_256_GCM_SHA384",
	":TLS_RSA_WITH_AES_128_CBC_SHA",
	":TLS_RSA_WITH_AES_256_CBC_SHA",
);

/// References <https://opengrind.org/grindr-api/security-headers#extensions>
const SIGALGS: &str = concat!(
	"ecdsa_secp256r1_sha256",
	":rsa_pss_rsae_sha256",
	":rsa_pkcs1_sha256",
	":ecdsa_secp384r1_sha384",
	":rsa_pss_rsae_sha384",
	":rsa_pkcs1_sha384",
	":rsa_pss_rsae_sha512",
	":rsa_pkcs1_sha512",
	":rsa_pkcs1_sha1",
);

const CURVES: &[SslCurve] =
	&[SslCurve::X25519, SslCurve::SECP256R1, SslCurve::SECP384R1];

/// References <https://opengrind.org/grindr-api/security-headers#pseudoheaders>
const PSEUDO_ORDER: [PseudoOrder; 4] = [
	PseudoOrder::Method,
	PseudoOrder::Path,
	PseudoOrder::Authority,
	PseudoOrder::Scheme,
];

/// References <https://opengrind.org/grindr-api/security-headers#frames>
const SETTINGS_ORDER: [SettingsOrder; 8] = [
	SettingsOrder::InitialWindowSize,
	SettingsOrder::HeaderTableSize,
	SettingsOrder::EnablePush,
	SettingsOrder::MaxConcurrentStreams,
	SettingsOrder::MaxFrameSize,
	SettingsOrder::MaxHeaderListSize,
	SettingsOrder::UnknownSetting8,
	SettingsOrder::UnknownSetting9,
];

const OKHTTP_WINDOW_SIZE: u32 = 16 * 1024 * 1024;

const OKHTTP_FIRST_STREAM_ID: u32 = 3;

const OKHTTP_POOL_IDLE: Duration = Duration::from_secs(5 * 60);
const OKHTTP_MAX_IDLE_CONNECTIONS: usize = 5;

fn okhttp_tls_config() -> TlsConfig {
	TlsConfig::builder()
		.enable_ocsp_stapling(true)
		.pre_shared_key(true)
		.curves(CURVES)
		.sigalgs_list(SIGALGS)
		.cipher_list(MODERN_TLS_CIPHERS)
		.min_tls_version(TlsVersion::TLS_1_2)
		.max_tls_version(TlsVersion::TLS_1_3)
		.build()
}

fn okhttp_http2_config() -> Http2Config {
	Http2Config::builder()
		.initial_stream_id(OKHTTP_FIRST_STREAM_ID)
		.initial_stream_window_size(OKHTTP_WINDOW_SIZE)
		.initial_connection_window_size(OKHTTP_WINDOW_SIZE)
		.headers_pseudo_order(PSEUDO_ORDER)
		.settings_order(SETTINGS_ORDER)
		.build()
}

static OKHTTP_WS_HEADER_ORDER: [HeaderName; 14] = [
	HeaderName::from_static("authorization"),
	HeaderName::from_static("l-time-zone"),
	HeaderName::from_static("l-grindr-roles"),
	HeaderName::from_static("l-device-info"),
	HeaderName::from_static("accept"),
	HeaderName::from_static("user-agent"),
	HeaderName::from_static("l-locale"),
	HeaderName::from_static("accept-language"),
	HeaderName::from_static("upgrade"),
	HeaderName::from_static("connection"),
	HeaderName::from_static("sec-websocket-key"),
	HeaderName::from_static("sec-websocket-version"),
	HeaderName::from_static("sec-websocket-extensions"),
	HeaderName::from_static("accept-encoding"),
];

fn grindr_ws_emulation() -> EmulationProvider {
	EmulationProvider::builder()
		.tls_config(okhttp_tls_config())
		.http1_config(Http1Config::builder().title_case_headers(true).build())
		.headers_order(&OKHTTP_WS_HEADER_ORDER[..])
		.default_headers(None)
		.build()
}

fn grindr_emulation() -> EmulationProvider {
	EmulationProvider::builder()
		.tls_config(okhttp_tls_config())
		.http2_config(okhttp_http2_config())
		.default_headers(None)
		.build()
}

/// The [`EmulationProvider`] that gives a `wreq` client the same TLS and HTTP/2
/// fingerprint as the Android app.
///
/// Use it to build your own `wreq::Client` with the same fingerprint (see the
/// `fingerprint_check` example).
pub fn probe_emulation() -> EmulationProvider {
	grindr_emulation()
}

/// okhttp's defaults
pub(crate) const CONNECT_TIMEOUT: Duration = Duration::from_secs(30);
pub(crate) const CALL_TIMEOUT: Duration = Duration::from_secs(35);

#[derive(Clone, Copy)]
pub(crate) struct Timeouts {
	pub read: Duration,
	pub upload: Duration,
	pub stall: Duration,
	pub media: Duration,
	pub media_body: Duration,
}

impl Default for Timeouts {
	fn default() -> Self {
		Self {
			read: Duration::from_secs(30),
			upload: Duration::from_secs(120),
			stall: Duration::from_secs(30),
			media: MEDIA_TIMEOUT,
			media_body: MEDIA_BODY_TIMEOUT,
		}
	}
}

pub(crate) struct ClientSetup {
	pub device: DeviceInfo,
	pub session: Option<Session>,
	pub timeouts: Timeouts,
}

/// Shared `wreq` setup: the emulation profile plus gzip-only encoding.
fn grindr_client_builder() -> wreq::ClientBuilder {
	Client::builder()
		.emulation(grindr_emulation())
		.gzip(true)
		.no_deflate()
		.no_brotli()
		.no_zstd()
		.connect_timeout(CONNECT_TIMEOUT)
		.pool_idle_timeout(OKHTTP_POOL_IDLE)
		.pool_max_idle_per_host(OKHTTP_MAX_IDLE_CONNECTIONS)
		.tcp_keepalive(None)
}

fn build_http_client(read_timeout: Duration) -> Result<Client, GrindrError> {
	grindr_client_builder()
		.read_timeout(read_timeout)
		.build()
		.map_err(Into::into)
}

#[cfg(not(test))]
fn media_client_builder() -> wreq::ClientBuilder {
	grindr_client_builder()
}

#[cfg(test)]
fn media_client_builder() -> wreq::ClientBuilder {
	if crate::media::relay::media_over_http2() {
		grindr_client_builder().http2_only()
	} else {
		grindr_client_builder()
	}
}

pub(crate) fn build_media_client(
	read_timeout: Duration,
	liveness: &Arc<MediaLiveness>,
) -> Result<Client, GrindrError> {
	media_client_builder()
		.read_timeout(read_timeout)
		.dns_resolver(Arc::clone(liveness))
		.connector_layer(CountConnections(Arc::clone(liveness)))
		.build()
		.map_err(Into::into)
}

fn build_ws_client() -> Result<Client, GrindrError> {
	// Websocket endpoint is http/1.1
	grindr_client_builder()
		.emulation(grindr_ws_emulation())
		.http1_only()
		.build()
		.map_err(Into::into)
}

/// Builds the transport shared by [`GrindrClient::new`] and [`GrindrClient::rotate_device`].
fn build_fingerprint(
	device: DeviceInfo,
	timeouts: Timeouts,
	media_liveness: &Arc<MediaLiveness>,
) -> Result<Arc<Fingerprint>, GrindrError> {
	let user_agent = build_user_agent(&device, "Free");
	let http = build_http_client(timeouts.read)?;
	let ws_http = build_ws_client()?;
	let media_http = build_media_client(timeouts.read, media_liveness)?;
	Ok(Arc::new(Fingerprint {
		http,
		ws_http,
		media_http,
		device,
		user_agent,
	}))
}

/// Everything needed to start the background websocket task.
struct WsSpawn {
	inner: Arc<InnerClient>,
	auth: Arc<AuthState>,
	channels: WsChannels,
	cmd_rx: mpsc::Receiver<WsCommand>,
}

/// An async client for the Grindr API.
///
/// Cheap to [`Clone`] — clones share the connection pool, session, and the
/// background websocket task. Build one with [`new`](Self::new), sign in with
/// [`sign_in_with_email`](Self::sign_in_with_email) or
/// [`sign_in_with_google`](Self::sign_in_with_google), then make requests with
/// [`request`](Self::request).
///
/// The realtime websocket is opt-in: REST works on its own and never opens a
/// socket. Call [`connect`](Self::connect) when you want realtime, then read
/// events from [`ws_receiver`](Self::ws_receiver). The background task is shared
/// across clones and started at most once.
///
/// The client owns no Tokio runtime. [`new`](Self::new) is sync and can be
/// called from non-async code; the websocket task attaches to the caller's
/// runtime the first time [`connect`](Self::connect) is called.
#[derive(Clone)]
pub struct GrindrClient {
	inner: Arc<InnerClient>,
	auth: Arc<AuthState>,
	session_rx: watch::Receiver<Option<Session>>,
	signing_key_rx: watch::Receiver<Option<DeviceSigningKey>>,
	ws_event_tx: broadcast::Sender<WsEvent>,
	ws_cmd_tx: mpsc::Sender<WsCommand>,
	ws_state_rx: watch::Receiver<WsConnectionState>,
	ws_started: Arc<Once>,
	ws_spawn: Arc<Mutex<Option<WsSpawn>>>,
}

impl GrindrClient {
	/// Creates a client for a [`DeviceInfo`], optionally resuming an account
	/// from saved [`Credentials`](crate::Credentials).
	///
	/// Pass `None` to start signed out, or `Session { credentials, token: None
	/// }` to resume without signing in again. This is sync and needs no
	/// runtime, and it never opens the websocket — call
	/// [`connect`](Self::connect) for that.
	pub fn new(
		device: DeviceInfo,
		session: Option<Session>,
	) -> Result<Self, GrindrError> {
		Self::from_setup(ClientSetup {
			device,
			session,
			timeouts: Timeouts::default(),
		})
	}

	pub(crate) fn from_setup(setup: ClientSetup) -> Result<Self, GrindrError> {
		let media_liveness = MediaLiveness::new();
		let fingerprint =
			build_fingerprint(setup.device, setup.timeouts, &media_liveness)?;

		let (signing_key_tx, signing_key_rx) = watch::channel(None);
		let inner = Arc::new(InnerClient {
			fingerprint: tokio::sync::RwLock::new(fingerprint),
			captcha: std::sync::OnceLock::new(),
			signing: tokio::sync::Mutex::new(None),
			signing_key_tx,
			server_offset_ms: std::sync::atomic::AtomicI64::new(0),
			timeouts: setup.timeouts,
			media_liveness,
		});

		let (auth_state, session_rx) = AuthState::new(setup.session);
		let auth = Arc::new(auth_state);

		let (ws_channels, ws_handles) = make_channels();

		let ws_event_tx = ws_channels.event_tx.clone();
		let ws_cmd_tx = ws_handles.cmd_tx;
		let ws_state_rx = ws_handles.state_rx;

		let ws_spawn = WsSpawn {
			inner: Arc::clone(&inner),
			auth: Arc::clone(&auth),
			channels: ws_channels,
			cmd_rx: ws_handles.cmd_rx,
		};

		Ok(Self {
			inner,
			auth,
			session_rx,
			signing_key_rx,
			ws_event_tx,
			ws_cmd_tx,
			ws_state_rx,
			ws_started: Arc::new(Once::new()),
			ws_spawn: Arc::new(Mutex::new(Some(ws_spawn))),
		})
	}

	/// Spawns the background websocket task once, on the current Tokio
	/// runtime. Cheap to call repeatedly, only the first call does any work.
	///
	/// Only reached through [`connect`](Self::connect), so it always runs inside
	/// an async context and the task attaches to the caller's runtime.
	fn ensure_ws_task(&self) {
		self.ws_started.call_once(|| {
			// Only this closure runs (once), so the parts are always present.
			if let Some(parts) = self.ws_spawn.lock().unwrap().take() {
				crate::ws::spawn_ws_task(
					parts.inner,
					parts.auth,
					parts.channels,
					parts.cmd_rx,
				);
			}
		});
	}

	/// Subscribes to [`AuthEvent`]s sent when a background token refresh fails
	/// (e.g. the session was revoked).
	pub fn auth_event_receiver(&self) -> broadcast::Receiver<AuthEvent> {
		self.auth.auth_event_tx.subscribe()
	}

	/// Watches the current [`Session`].
	///
	/// It changes on sign-in, refresh, and sign-out — read it here to persist
	/// its [`credentials`](crate::Session::credentials) to disk.
	pub fn session_receiver(&self) -> watch::Receiver<Option<Session>> {
		self.session_rx.clone()
	}

	/// Watches the [`DeviceSigningKey`]; it clears on
	/// [`sign_out`](Self::sign_out) and [`rotate_device`](Self::rotate_device).
	pub fn signing_key_receiver(
		&self,
	) -> watch::Receiver<Option<DeviceSigningKey>> {
		self.signing_key_rx.clone()
	}

	/// Restores a saved [`DeviceSigningKey`] and returns whether it was taken;
	/// a key that cannot be decoded or belongs to another account is refused.
	#[must_use]
	pub async fn restore_signing_key(&self, key: DeviceSigningKey) -> bool {
		self.inner.restore_signing_key(&self.auth, key).await
	}

	/// Watches the websocket [`WsConnectionState`].
	pub fn connection_state(&self) -> watch::Receiver<WsConnectionState> {
		self.ws_state_rx.clone()
	}

	/// Marks the client active or idle; clients start active. Set `false` while
	/// the host app is backgrounded.
	///
	/// Idle, the websocket disconnects and stops reconnecting and a failed
	/// refresh raises no [`RefreshFailed`](crate::AuthEvent::RefreshFailed),
	/// terminal events and REST calls are unaffected. Returning to active
	/// reconnects at once.
	pub fn set_active(&self, active: bool) {
		self.auth.set_active(active);
	}

	/// Whether the client is [active](Self::set_active).
	pub fn is_active(&self) -> bool {
		self.auth.is_active()
	}

	/// Drops the connection pool and TLS session cache, keeping the device
	/// identity, the session, and the signing key. Worth calling on resume:
	/// sockets that idled through a suspend are often dead with neither end
	/// having noticed, stalling the first request that inherits one.
	pub async fn reset_transport(&self) -> Result<(), GrindrError> {
		let device = self.inner.fingerprint().await.device.clone();
		let fingerprint = build_fingerprint(
			device,
			self.inner.timeouts,
			&self.inner.media_liveness,
		)?;
		*self.inner.fingerprint.write().await = fingerprint;
		Ok(())
	}

	/// Subscribes to incoming [`WsEvent`]s (messages, taps, presence). You only
	/// get events sent after you subscribe.
	pub fn ws_receiver(&self) -> broadcast::Receiver<WsEvent> {
		self.ws_event_tx.subscribe()
	}

	/// A sender for [`WsCommand`]s over the websocket.
	pub fn ws_sender(&self) -> mpsc::Sender<WsCommand> {
		self.ws_cmd_tx.clone()
	}

	/// Starts the shared websocket task unless it is running.
	pub async fn connect(&self) {
		self.ensure_ws_task();
	}

	/// Creates a first-party account with email and password
	/// (`POST /v8/users`) and returns its profile id. The response carries no
	/// session: sign in afterwards on the same device.
	pub async fn create_account_with_email(
		&self,
		account: &crate::NewEmailAccount<'_>,
	) -> Result<String, GrindrError> {
		crate::auth::create_account_with_email(&self.inner, account).await
	}

	/// Signs in with email and password and stores the session.
	pub async fn sign_in_with_email(
		&self,
		email: &str,
		password: &str,
	) -> Result<SignInResult, GrindrError> {
		self.sign_in_with_email_at_geohash(email, password, None)
			.await
	}

	/// Like [`sign_in_with_email`](Self::sign_in_with_email), but tags the
	/// sign-in request with a `geohash` so the server records that approximate
	/// location for the new session. Only this initial request carries it;
	/// later background refreshes do not. Pass `None` to omit it.
	pub async fn sign_in_with_email_at_geohash(
		&self,
		email: &str,
		password: &str,
		geohash: Option<&str>,
	) -> Result<SignInResult, GrindrError> {
		crate::auth::sign_in_with_email(
			&self.inner,
			&self.auth,
			email,
			password,
			geohash,
			None,
		)
		.await
	}

	/// Signs in with email and password plus a reCAPTCHA token, storing the
	/// session.
	pub async fn sign_in_with_email_captcha(
		&self,
		email: &str,
		password: &str,
		captcha_token: &str,
	) -> Result<SignInResult, GrindrError> {
		crate::auth::sign_in_with_email(
			&self.inner,
			&self.auth,
			email,
			password,
			None,
			Some(captcha_token),
		)
		.await
	}

	/// Signs in with a Google OAuth access token and stores the session.
	pub async fn sign_in_with_google(
		&self,
		google_access_token: &str,
	) -> Result<SignInResult, GrindrError> {
		self.sign_in_with_google_at_geohash(google_access_token, None)
			.await
	}

	/// Like [`sign_in_with_google`](Self::sign_in_with_google), but tags the
	/// sign-in request with a `geohash`. Only this initial request carries it.
	/// Pass `None` to omit it.
	pub async fn sign_in_with_google_at_geohash(
		&self,
		google_access_token: &str,
		geohash: Option<&str>,
	) -> Result<SignInResult, GrindrError> {
		self.sign_in_with_third_party_at_geohash(
			SessionKind::Google,
			google_access_token,
			geohash,
		)
		.await
	}

	/// Signs in with a Facebook user access token and stores the session.
	pub async fn sign_in_with_facebook(
		&self,
		facebook_access_token: &str,
	) -> Result<SignInResult, GrindrError> {
		self.sign_in_with_third_party_at_geohash(
			SessionKind::Facebook,
			facebook_access_token,
			None,
		)
		.await
	}

	/// Like [`sign_in_with_facebook`](Self::sign_in_with_facebook), but tags
	/// the sign-in request with a `geohash`.
	pub async fn sign_in_with_facebook_at_geohash(
		&self,
		facebook_access_token: &str,
		geohash: Option<&str>,
	) -> Result<SignInResult, GrindrError> {
		self.sign_in_with_third_party_at_geohash(
			SessionKind::Facebook,
			facebook_access_token,
			geohash,
		)
		.await
	}

	/// Signs in with any third-party provider token. `kind` selects the
	/// `thirdPartyVendor`; [`SessionKind::Email`] is rejected.
	pub async fn sign_in_with_third_party_at_geohash(
		&self,
		kind: SessionKind,
		provider_access_token: &str,
		geohash: Option<&str>,
	) -> Result<SignInResult, GrindrError> {
		crate::auth::sign_in_with_third_party(
			&self.inner,
			&self.auth,
			kind,
			provider_access_token,
			geohash,
		)
		.await
	}

	/// Forces a session refresh.
	///
	/// This happens automatically before the token expires, so you rarely need
	/// to call it yourself.
	pub async fn refresh_session(&self) -> Result<SignInResult, GrindrError> {
		self.refresh_session_at_geohash(None).await
	}

	/// Like [`refresh_session`](Self::refresh_session), but tags the refresh
	/// request with a `geohash`. Useful to seed the location of a session
	/// resumed from a saved `auth_token` on its first request. Automatic
	/// background refreshes never carry a geohash. Pass `None` to omit it.
	pub async fn refresh_session_at_geohash(
		&self,
		geohash: Option<&str>,
	) -> Result<SignInResult, GrindrError> {
		crate::auth::refresh_session(&self.inner, &self.auth, geohash).await
	}

	/// Clears the session and closes the websocket, without reconnecting while
	/// signed out. Keeps the device identity and transport — use
	/// [`sign_out_rotating`](Self::sign_out_rotating) to also rotate those.
	pub async fn sign_out(&self) {
		self.auth.clear_session().await;
		self.inner.clear_signing().await;
	}

	/// Starts a request to `path`, which must start with `/`.
	pub fn request(&self, method: Method, path: &str) -> RequestBuilder {
		RequestBuilder::new(
			Arc::clone(&self.inner),
			Arc::clone(&self.auth),
			method,
			path,
		)
	}

	/// Registers the device signing key unless one exists.
	pub async fn register_device_key(&self) -> Result<(), GrindrError> {
		self.inner.ensure_device_key(&self.auth).await
	}

	/// Fetches a CDN file with the API's fingerprint on a pool of its own, with
	/// the headers the app's image loader sends.
	///
	/// Only `https` on `cdns.grindr.com` or `*.cloudfront.net` is accepted,
	/// redirects included; anything else is [`GrindrError::InvalidRequest`]
	/// before a socket is opened. The headers must arrive within 20 s and the
	/// body within 120 s, with a read timeout between two pieces. If the
	/// headers are late, the request went out on an already-open connection,
	/// and nothing else arrived from that host while it waited, the connection
	/// is assumed dead and the request is sent once more on a new one. A
	/// non-success status comes back as an ordinary [`MediaResponse`].
	pub async fn fetch_media(
		&self,
		request: MediaRequest<'_>,
	) -> Result<MediaResponse, GrindrError> {
		self.inner.fetch_media(request).await
	}

	/// Opens a CDN file as a stream, with the same transport, headers and host
	/// rules as [`fetch_media`](Self::fetch_media).
	///
	/// The headers must arrive within 20 s; the body has no total deadline,
	/// only a read timeout between two pieces. Late headers get the same single
	/// retry on a new connection as in [`fetch_media`](Self::fetch_media). A
	/// non-success status comes back as an ordinary [`MediaStream`].
	pub async fn stream_media(
		&self,
		request: StreamRequest<'_>,
	) -> Result<MediaStream, GrindrError> {
		self.inner.stream_media(request).await
	}

	/// Replaces the device identity and the underlying HTTP/TLS transport while
	/// keeping the session, and returns the old device. Building new `wreq`
	/// clients also drops the connection pool and TLS session-resumption cache,
	/// so nothing from the old device carries over to later requests.
	pub async fn rotate_device(
		&self,
		device: DeviceInfo,
	) -> Result<DeviceInfo, GrindrError> {
		let new_fp = build_fingerprint(
			device,
			self.inner.timeouts,
			&self.inner.media_liveness,
		)?;
		let old_fp = {
			let mut guard = self.inner.fingerprint.write().await;
			std::mem::replace(&mut *guard, new_fp)
		};
		self.inner.clear_signing().await;
		Ok(old_fp.device.clone())
	}

	/// [`sign_out`](Self::sign_out) then
	/// [`rotate_device`](Self::rotate_device): clears the session and rotates
	/// the device identity and transport so the next sign-in cannot be
	/// correlated with this one. Pass a fresh [`DeviceInfo`] to persist and
	/// reuse until the next sign-out; returns the old device.
	pub async fn sign_out_rotating(
		&self,
		device: DeviceInfo,
	) -> Result<DeviceInfo, GrindrError> {
		self.sign_out().await;
		self.rotate_device(device).await
	}

	/// The device identity currently in use.
	pub async fn current_device(&self) -> DeviceInfo {
		self.inner.fingerprint().await.device.clone()
	}

	/// Whether the server has first-party reCAPTCHA enabled. No auth needed.
	/// Registers a [`CaptchaTokenProvider`](crate::CaptchaTokenProvider) the
	/// client uses to obtain the `X-Grindr-Captcha-Token` for captcha
	/// requests (currently device-key registration). Without one, the client uses
	/// the no-captcha endpoints. Set once; later calls are ignored.
	pub fn set_captcha_provider(
		&self,
		provider: std::sync::Arc<dyn crate::captcha::CaptchaTokenProvider>,
	) {
		let _ = self.inner.captcha.set(provider);
	}

	/// Reports whether the server's assignments require device key registration
	/// with a captcha (`recaptcha_device_key_registration`), so a provider can
	/// decide whether a token is needed.
	pub async fn recaptcha_device_key_registration_enabled(
		&self,
	) -> Result<bool, GrindrError> {
		crate::auth::recaptcha_device_key_registration_enabled(&self.inner)
			.await
	}

	/// Reports whether the server's assignments enable first-party reCAPTCHA
	/// (`recaptcha_first_party`), which selects the `v9` over the `v8` sign-in
	/// session endpoint.
	pub async fn recaptcha_first_party_enabled(
		&self,
	) -> Result<bool, GrindrError> {
		crate::auth::recaptcha_first_party_enabled(&self.inner).await
	}
}

#[cfg(test)]
impl GrindrClient {
	pub(crate) async fn replace_http_client(&self, http: Client) {
		let mut fingerprint = self.inner.fingerprint.write().await;
		*fingerprint = Arc::new(Fingerprint {
			http,
			ws_http: fingerprint.ws_http.clone(),
			media_http: fingerprint.media_http.clone(),
			device: fingerprint.device.clone(),
			user_agent: fingerprint.user_agent.clone(),
		});
	}

	pub(crate) fn media_retirements(&self) -> u64 {
		self.inner.media_liveness.retirements()
	}
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::auth::{Credentials, SessionToken};
	use crate::request::Body;
	use wreq::header::HeaderValue;

	#[test]
	fn new_does_not_require_a_runtime() {
		// The constructor is synchronous and must not panic when called outside
		// of any Tokio runtime.
		let client = GrindrClient::new(DeviceInfo::generate(), None).unwrap();
		assert!(!client.ws_started.is_completed());
	}

	#[test]
	fn only_byte_bodies_get_the_upload_timeouts() {
		let upload = Duration::from_secs(7);
		let client = GrindrClient::from_setup(ClientSetup {
			device: DeviceInfo::generate(),
			session: None,
			timeouts: Timeouts {
				upload,
				..Timeouts::default()
			},
		})
		.unwrap();
		let jpeg = bytes::Bytes::from_static(b"jpeg");
		let content_type = HeaderValue::from_static("image/jpeg");
		let raw = Body::Bytes {
			content_type: content_type.clone(),
			bytes: jpeg.clone(),
		};
		let signed = Body::Signed {
			content_type,
			bytes: jpeg,
		};
		let json = Body::json(&serde_json::json!({})).unwrap();
		let timeouts_for = |body: &Body| {
			let request = client
				.inner
				.apply_timeouts(Client::new().post("http://localhost/"), body)
				.build()
				.unwrap();
			(request.timeout().copied(), request.read_timeout().copied())
		};

		assert_eq!(timeouts_for(&raw), (Some(upload), Some(upload)));
		assert_eq!(timeouts_for(&signed), (Some(upload), Some(upload)));
		assert_eq!(timeouts_for(&json), (Some(CALL_TIMEOUT), None));
		assert_eq!(timeouts_for(&Body::Empty), (Some(CALL_TIMEOUT), None));
		assert!(Timeouts::default().upload > CALL_TIMEOUT);
	}

	#[tokio::test]
	async fn a_bytes_upload_slower_than_the_read_timeout_succeeds() {
		let client = GrindrClient::from_setup(ClientSetup {
			device: DeviceInfo::generate(),
			session: Some(fake_session()),
			timeouts: Timeouts {
				read: Duration::from_millis(200),
				..Timeouts::default()
			},
		})
		.unwrap();
		let slow_upload = format!("{}600", crate::testserver::SLOW_READ_PREFIX);
		let bytes = vec![0u8; 64 * 1024];

		let unsigned = client
			.request(Method::POST, &slow_upload)
			.bytes("application/octet-stream", bytes.clone())
			.send()
			.await
			.unwrap();
		let signed = client
			.request(Method::POST, &slow_upload)
			.signed_bytes("application/octet-stream", bytes)
			.send()
			.await
			.unwrap();

		assert_eq!(unsigned.status, 200);
		assert_eq!(signed.status, 200);
	}

	fn late_unauthorized(millis: u64) -> String {
		format!("{}{millis}", crate::testserver::LATE_UNAUTHORIZED_PREFIX)
	}

	fn attempts_at(device_id: &str, path: &str) -> usize {
		crate::testserver::requests_from(device_id)
			.iter()
			.filter(|r| r.path == path)
			.count()
	}

	#[tokio::test]
	async fn a_401_is_retried_once_under_the_same_account() {
		let device = DeviceInfo::generate();
		let device_id = device.device_id.clone();
		let fake = fake_session();
		let session = Session {
			credentials: Credentials {
				profile_id: Some(
					crate::testserver::REFRESHED_PROFILE_ID.to_owned(),
				),
				..fake.credentials
			},
			..fake
		};
		let client = GrindrClient::new(device, Some(session)).unwrap();
		let path = late_unauthorized(0);

		let resp = client.request(Method::GET, &path).send().await.unwrap();

		assert_eq!(resp.status, 401);
		assert_eq!(attempts_at(&device_id, &path), 2);
	}

	#[tokio::test]
	async fn a_401_is_not_retried_after_another_account_signs_in() {
		let device = DeviceInfo::generate();
		let device_id = device.device_id.clone();
		let client = GrindrClient::new(device, Some(fake_session())).unwrap();
		let path = late_unauthorized(300);

		let (result, signed_in) = tokio::join!(
			client.request(Method::GET, &path).send(),
			client.sign_in_with_email("b@example.com", "pw"),
		);

		assert_eq!(
			signed_in.unwrap().profile_id,
			crate::testserver::REFRESHED_PROFILE_ID
		);
		assert!(
			matches!(result, Err(GrindrError::SessionCleared)),
			"got {result:?}"
		);
		assert_eq!(attempts_at(&device_id, &path), 1);
	}

	#[tokio::test]
	async fn a_signed_401_is_not_retried_after_another_account_signs_in() {
		let device = DeviceInfo::generate();
		let device_id = device.device_id.clone();
		let client = GrindrClient::new(device, Some(fake_session())).unwrap();
		let own_key = crate::signing::DeviceKey::generate("1".to_owned());
		assert!(client.restore_signing_key(own_key.export()).await);
		let path = late_unauthorized(300);

		let (result, signed_in) = tokio::join!(
			client
				.request(Method::POST, &path)
				.signed_bytes("image/jpeg", vec![0xFF, 0xD8])
				.send(),
			client.sign_in_with_email("b@example.com", "pw"),
		);

		signed_in.unwrap();
		assert!(
			matches!(result, Err(GrindrError::SessionCleared)),
			"got {result:?}"
		);
		assert_eq!(attempts_at(&device_id, &path), 1);
	}

	#[tokio::test]
	async fn signing_in_with_a_captcha_token_posts_it_to_the_v9_endpoint() {
		let device = DeviceInfo::generate();
		let device_id = device.device_id.clone();
		let client = GrindrClient::new(device, None).unwrap();

		client
			.sign_in_with_email_captcha("a@b.c", "pw", "captcha-tok")
			.await
			.unwrap();

		let requests = crate::testserver::requests_from(&device_id);
		let sign_in = requests
			.iter()
			.find(|r| r.path == "/v9/sessions")
			.expect("expected a v9 sign-in request");
		let body: serde_json::Value =
			serde_json::from_str(&sign_in.body).unwrap();
		assert_eq!(body["captchaToken"], "captcha-tok");
		assert!(
			!requests.iter().any(|r| r.path == "/v8/sessions"),
			"the captcha sign-in must not touch the plain endpoint"
		);
	}

	#[tokio::test]
	async fn signing_in_without_a_captcha_token_stays_on_the_plain_endpoint() {
		let device = DeviceInfo::generate();
		let device_id = device.device_id.clone();
		let client = GrindrClient::new(device, None).unwrap();

		client.sign_in_with_email("a@b.c", "pw").await.unwrap();

		let requests = crate::testserver::requests_from(&device_id);
		let sign_in = requests
			.iter()
			.find(|r| r.path == "/v8/sessions")
			.expect("expected a v8 sign-in request");
		assert!(
			!sign_in.body.contains("captchaToken"),
			"the plain sign-in must not carry a captcha token"
		);
	}

	fn queue_signing_rejections(device_id: &str, path: &str, kinds: &[&str]) {
		crate::testserver::queue_replies(crate::testserver::QueuedReplies {
			device_id,
			path,
			replies: kinds
				.iter()
				.map(|kind| {
					("400 Bad Request", format!(r#"{{"type":"{kind}"}}"#))
				})
				.collect(),
		});
	}

	struct SignedClient {
		client: GrindrClient,
		device_id: String,
	}

	async fn signed_client() -> SignedClient {
		let device = DeviceInfo::generate();
		let device_id = device.device_id.clone();
		let client = GrindrClient::new(device, Some(fake_session())).unwrap();
		let key = crate::signing::DeviceKey::generate("1".to_owned());
		assert!(client.restore_signing_key(key.export()).await);
		SignedClient { client, device_id }
	}

	impl SignedClient {
		fn post_signed(&self, path: &str) -> RequestBuilder {
			self.client
				.request(Method::POST, path)
				.signed_bytes("image/jpeg", vec![0xFF, 0xD8])
		}
	}

	#[tokio::test]
	async fn a_clock_rejection_is_re_signed_once_and_keeps_the_key() {
		let signed = signed_client().await;
		let path = crate::testserver::ACCEPTING_PATH;
		queue_signing_rejections(
			&signed.device_id,
			path,
			&["timestamp_drift", "nonce_replayed"],
		);

		let response = signed.post_signed(path).send().await.unwrap();

		assert_eq!(response.status, 400);
		let nonces: Vec<_> =
			crate::testserver::requests_from(&signed.device_id)
				.iter()
				.filter(|r| r.path == path)
				.map(|r| r.header("x-nonce").unwrap().to_owned())
				.collect();
		assert_eq!(nonces.len(), 2);
		assert_ne!(nonces[0], nonces[1]);
		assert!(signed.client.signing_key_receiver().borrow().is_some());
	}

	#[tokio::test]
	async fn any_other_signing_rejection_drops_the_key() {
		let signed = signed_client().await;
		let path = crate::testserver::ACCEPTING_PATH;
		queue_signing_rejections(&signed.device_id, path, &["bad_signature"]);

		let response = signed.post_signed(path).send().await.unwrap();

		assert_eq!(response.status, 400);
		assert_eq!(attempts_at(&signed.device_id, path), 1);
		assert!(signed.client.signing_key_receiver().borrow().is_none());
	}

	#[tokio::test]
	async fn a_clock_rejection_is_not_re_signed_after_another_account_signs_in()
	{
		let signed = signed_client().await;
		let path = late_unauthorized(300);
		queue_signing_rejections(
			&signed.device_id,
			&path,
			&["timestamp_drift"],
		);

		let (result, signed_in) = tokio::join!(
			signed.post_signed(&path).send(),
			signed.client.sign_in_with_email("b@example.com", "pw"),
		);

		signed_in.unwrap();
		assert!(
			matches!(result, Err(GrindrError::SessionCleared)),
			"got {result:?}"
		);
		assert_eq!(attempts_at(&signed.device_id, &path), 1);
	}

	#[tokio::test]
	async fn rest_calls_do_not_start_the_ws_task() {
		let client = GrindrClient::new(DeviceInfo::generate(), None).unwrap();

		let err = client
			.request(Method::GET, "/v3/me/profile")
			.send()
			.await
			.unwrap_err();

		assert!(matches!(err, GrindrError::Auth(_)));
		assert!(!client.ws_started.is_completed());
	}

	#[tokio::test]
	async fn a_session_without_a_token_is_never_sent_as_an_empty_bearer() {
		let device = DeviceInfo::generate();
		let device_id = device.device_id.clone();
		crate::testserver::queue_replies(crate::testserver::QueuedReplies {
			device_id: &device_id,
			path: "/v8/sessions",
			replies: vec![("503 Service Unavailable", "{}".to_owned())],
		});
		let client =
			GrindrClient::new(device, Some(resumed("a@b.c", "auth-tok")))
				.unwrap();

		let err = client
			.request(Method::GET, "/v3/me/profile")
			.send()
			.await
			.unwrap_err();
		assert!(matches!(err, GrindrError::Auth(_)), "got {err:?}");

		let requests = crate::testserver::requests_from(&device_id);
		assert!(
			requests.iter().all(|r| r.path != "/v3/me/profile"),
			"the authenticated call must never leave without a token"
		);
	}

	#[tokio::test]
	async fn no_auth_requests_need_no_session_but_validate_the_path() {
		let client = GrindrClient::new(DeviceInfo::generate(), None).unwrap();

		let err = client
			.request(Method::GET, "evil.com/x")
			.unauthenticated()
			.send()
			.await
			.unwrap_err();
		assert!(matches!(err, GrindrError::InvalidRequest(_)));
		assert!(!client.ws_started.is_completed());
	}

	#[tokio::test]
	async fn bytes_requests_require_a_session_and_validate_the_path() {
		let client = GrindrClient::new(DeviceInfo::generate(), None).unwrap();

		let err = client
			.request(Method::POST, crate::testserver::ACCEPTING_PATH)
			.bytes("image/jpeg", vec![0xFF, 0xD8])
			.send()
			.await
			.unwrap_err();
		assert!(matches!(err, GrindrError::Auth(_)));

		let err = client
			.request(Method::POST, "evil.com/x")
			.bytes("image/jpeg", Vec::new())
			.send()
			.await
			.unwrap_err();
		assert!(matches!(err, GrindrError::InvalidRequest(_)));
	}

	#[tokio::test]
	async fn a_token_resumed_session_refreshes_before_its_first_request() {
		let device = DeviceInfo::generate();
		let device_id = device.device_id.clone();
		let client =
			GrindrClient::new(device, Some(resumed("a@b.c", "stored-tok")))
				.unwrap();

		let resp = client
			.request(Method::GET, "/v3/bootstrap")
			.send()
			.await
			.unwrap();
		assert_eq!(resp.status, 200);

		let requests = crate::testserver::requests_from(&device_id);
		assert_eq!(
			requests[0].path, "/v8/sessions",
			"the refresh must precede the call it authorizes"
		);
		assert_eq!(requests[1].path, "/v3/bootstrap");

		let refreshed = client.session_receiver().borrow().clone().unwrap();
		assert_eq!(
			refreshed.credentials.profile_id.as_deref(),
			Some(crate::testserver::REFRESHED_PROFILE_ID)
		);
		let bearer = format!("Grindr3 {}", refreshed.token.unwrap().session_id);
		assert_eq!(requests[1].header("authorization"), Some(bearer.as_str()));
	}

	#[tokio::test]
	async fn a_failing_refresh_is_reported_once_then_retracted_on_recovery() {
		let device = DeviceInfo::generate();
		let device_id = device.device_id.clone();
		crate::testserver::queue_replies(crate::testserver::QueuedReplies {
			device_id: &device_id,
			path: "/v8/sessions",
			replies: vec![("503 Service Unavailable", "{}".to_owned())],
		});
		let client =
			GrindrClient::new(device, Some(expired_session())).unwrap();
		let mut events = client.auth_event_receiver();

		client
			.request(Method::GET, "/v3/bootstrap")
			.send()
			.await
			.unwrap();

		let event = events.try_recv().unwrap();
		let AuthEvent::RefreshFailed { kind, .. } = event else {
			panic!("expected a RefreshFailed, got {event:?}");
		};
		assert_eq!(kind, crate::auth::RefreshFailureKind::Server);

		client.refresh_session().await.unwrap();
		assert!(matches!(events.try_recv(), Ok(AuthEvent::RefreshRecovered)));
	}

	#[tokio::test]
	async fn a_burst_of_calls_on_a_dead_network_refreshes_once() {
		let device = DeviceInfo::generate();
		let device_id = device.device_id.clone();
		crate::testserver::queue_replies(crate::testserver::QueuedReplies {
			device_id: &device_id,
			path: "/v8/sessions",
			replies: vec![("503 Service Unavailable", "{}".to_owned()); 8],
		});
		let client =
			GrindrClient::new(device, Some(expired_session())).unwrap();

		let calls = (0..8).map(|_| {
			let client = client.clone();
			async move {
				let _ =
					client.request(Method::GET, "/v3/bootstrap").send().await;
			}
		});
		futures_util::future::join_all(calls).await;

		let refreshes = crate::testserver::requests_from(&device_id)
			.iter()
			.filter(|r| r.path == "/v8/sessions")
			.count();
		assert_eq!(
			refreshes, 1,
			"the cooldown must collapse the waiters queued behind the first \
			 failed refresh, not let each one retry"
		);
	}

	#[tokio::test]
	async fn an_idle_client_reports_nothing_but_still_serves_rest_calls() {
		let device = DeviceInfo::generate();
		let device_id = device.device_id.clone();
		crate::testserver::queue_replies(crate::testserver::QueuedReplies {
			device_id: &device_id,
			path: "/v8/sessions",
			replies: vec![("503 Service Unavailable", "{}".to_owned())],
		});
		let client =
			GrindrClient::new(device, Some(expired_session())).unwrap();
		let mut events = client.auth_event_receiver();
		client.set_active(false);

		client
			.request(Method::GET, "/v3/bootstrap")
			.send()
			.await
			.unwrap();

		assert!(
			events.try_recv().is_err(),
			"a backgrounded app must not raise a failure the user cannot act on"
		);
		assert!(!client.is_active());
		client.set_active(true);
		assert!(client.is_active());
	}

	#[tokio::test]
	async fn reset_transport_keeps_the_device_and_the_session() {
		let device = DeviceInfo::generate();
		let client =
			GrindrClient::new(device.clone(), Some(fake_session())).unwrap();

		client.reset_transport().await.unwrap();

		assert_eq!(client.current_device().await.device_id, device.device_id);
		assert!(client.session_receiver().borrow().is_some());
	}

	#[tokio::test]
	async fn an_unsigned_upload_registers_no_key_and_signs_nothing() {
		let device = DeviceInfo::generate();
		let device_id = device.device_id.clone();
		let client =
			GrindrClient::new(device, Some(resumed("a@b.c", "stored-tok")))
				.unwrap();

		client
			.request(Method::POST, crate::testserver::ACCEPTING_PATH)
			.bytes("image/jpeg", vec![0xFF, 0xD8])
			.send()
			.await
			.unwrap();

		let requests = crate::testserver::requests_from(&device_id);
		let paths: Vec<&str> =
			requests.iter().map(|r| r.path.as_str()).collect();
		assert_eq!(
			paths,
			["/v8/sessions", crate::testserver::ACCEPTING_PATH],
			"the unsigned path must not touch the device-key endpoints"
		);

		let upload = requests.last().unwrap();
		assert_eq!(upload.method, "POST");
		assert_eq!(upload.header("content-type"), Some("image/jpeg"));
		assert_eq!(upload.header("x-key-id"), None);
		assert_eq!(upload.header("x-sig"), None);
	}

	#[tokio::test]
	async fn a_token_resumed_upload_binds_the_key_to_the_refreshed_profile_id()
	{
		use base64::engine::general_purpose::URL_SAFE_NO_PAD;
		use base64::Engine;
		use p256::ecdsa::{signature::Verifier, DerSignature, VerifyingKey};
		use spki::DecodePublicKey;

		let device = DeviceInfo::generate();
		let device_id = device.device_id.clone();
		let client =
			GrindrClient::new(device, Some(resumed("a@b.c", "stored-tok")))
				.unwrap();

		client
			.request(Method::POST, crate::testserver::ACCEPTING_PATH)
			.signed_bytes("image/jpeg", vec![0xFF, 0xD8])
			.send()
			.await
			.unwrap();

		let requests = crate::testserver::requests_from(&device_id);
		let paths: Vec<&str> =
			requests.iter().map(|r| r.path.as_str()).collect();
		assert_eq!(
			paths,
			[
				"/v8/sessions",
				"/v1/verification/device-keys/challenge",
				"/v1/verification/device-keys",
				crate::testserver::ACCEPTING_PATH,
			],
			"the refresh must land before the key is generated"
		);

		assert_eq!(requests[2].method, "POST");
		let registration: serde_json::Value =
			serde_json::from_str(&requests[2].body).unwrap();
		let public_key = registration["publicKey"].as_str().unwrap();
		let key_id = registration["keyId"].as_str().unwrap();
		let signature = registration["registrationSignature"].as_str().unwrap();

		let verifying = VerifyingKey::from(
			p256::PublicKey::from_public_key_der(
				&URL_SAFE_NO_PAD.decode(public_key).unwrap(),
			)
			.unwrap(),
		);
		let der = URL_SAFE_NO_PAD.decode(signature).unwrap();
		let signature = DerSignature::try_from(der.as_slice()).unwrap();
		let signed_for = |user_id: &str| {
			format!(
				"{user_id}|{key_id}|{public_key}|{device_id}|{}",
				crate::testserver::CHALLENGE
			)
		};

		assert!(
			verifying
				.verify(
					signed_for(crate::testserver::REFRESHED_PROFILE_ID)
						.as_bytes(),
					&signature
				)
				.is_ok(),
			"the key must bind to the refreshed profile id"
		);
		assert!(
			verifying
				.verify(signed_for("").as_bytes(), &signature)
				.is_err(),
			"the key must not bind to the blank pre-refresh profile id"
		);
	}

	#[tokio::test]
	async fn registering_twice_without_a_provider_posts_v1_once() {
		let device = DeviceInfo::generate();
		let device_id = device.device_id.clone();
		let client =
			GrindrClient::new(device, Some(resumed("a@b.c", "stored-tok")))
				.unwrap();

		client.register_device_key().await.unwrap();
		client.register_device_key().await.unwrap();

		let requests = crate::testserver::requests_from(&device_id);
		let paths: Vec<&str> =
			requests.iter().map(|r| r.path.as_str()).collect();
		assert_eq!(
			paths,
			[
				"/v8/sessions",
				"/v1/verification/device-keys/challenge",
				"/v1/verification/device-keys",
			],
			"a registered key must not be registered again"
		);
		assert!(client.signing_key_receiver().borrow().is_some());
	}

	#[tokio::test]
	async fn no_auth_requests_carry_no_credentials_even_with_a_session() {
		let device = DeviceInfo::generate();
		let device_id = device.device_id.clone();
		let client = GrindrClient::new(device, Some(fake_session())).unwrap();

		let resp = client
			.request(Method::GET, "/v3/bootstrap")
			.unauthenticated()
			.send()
			.await
			.unwrap();
		assert_eq!(resp.status, 200);
		assert_eq!(resp.body, br#"{"ok":true}"#);

		let requests = crate::testserver::requests_from(&device_id);
		let bootstrap = &requests[0];
		assert_eq!(bootstrap.method, "GET");
		assert_eq!(bootstrap.path, "/v3/bootstrap");
		assert_eq!(bootstrap.header("authorization"), None);
		assert_eq!(bootstrap.header("l-grindr-roles"), None);
		assert!(bootstrap.header("l-device-info").is_some());
	}

	#[tokio::test]
	async fn connect_starts_the_ws_task() {
		// Resuming a session and only calling connect() (no request) must still
		// bring the background task up.
		let client = GrindrClient::new(DeviceInfo::generate(), None).unwrap();
		assert!(!client.ws_started.is_completed());
		client.connect().await;
		assert!(client.ws_started.is_completed());
	}

	#[tokio::test]
	async fn dropping_client_in_async_context_does_not_panic() {
		// Regression guard: the old owned-runtime design panicked when the last
		// clone was dropped inside an async context.
		let client = GrindrClient::new(DeviceInfo::generate(), None).unwrap();
		let clone = client.clone();
		drop(client);
		drop(clone);
	}

	#[tokio::test]
	async fn a_captcha_provider_registers_the_key_over_v2_with_the_token() {
		let device = DeviceInfo::generate();
		let device_id = device.device_id.clone();
		let client =
			GrindrClient::new(device, Some(resumed("a@b.c", "stored-tok")))
				.unwrap();
		client.set_captcha_provider(std::sync::Arc::new(
			crate::testserver::FixedCaptcha,
		));

		client
			.request(Method::POST, crate::testserver::ACCEPTING_PATH)
			.signed_bytes("image/jpeg", vec![0xFF, 0xD8])
			.send()
			.await
			.unwrap();

		let requests = crate::testserver::requests_from(&device_id);
		let paths: Vec<&str> =
			requests.iter().map(|r| r.path.as_str()).collect();
		assert_eq!(
			paths,
			[
				"/v8/sessions",
				"/v1/verification/device-keys/challenge",
				"/v2/verification/device-keys",
				crate::testserver::ACCEPTING_PATH,
			]
		);

		let registration = requests
			.iter()
			.find(|r| r.path == "/v2/verification/device-keys")
			.unwrap();
		assert_eq!(
			registration.header("x-grindr-captcha-token"),
			Some("captcha-xyz")
		);
	}

	fn resumed(email: &str, auth_token: &str) -> Session {
		Session {
			credentials: Credentials {
				email: email.to_owned(),
				profile_id: None,
				auth_token: auth_token.to_owned(),
				kind: crate::auth::SessionKind::Email,
				third_party_user_id: None,
			},
			token: None,
		}
	}

	fn expired_session() -> Session {
		Session {
			token: Some(SessionToken {
				session_id: "stale-sid".to_owned(),
				expires_at: 0,
				restriction: None,
			}),
			..fake_session()
		}
	}

	fn fake_session() -> Session {
		Session {
			credentials: Credentials {
				email: "user@example.com".to_owned(),
				profile_id: Some("1".to_owned()),
				auth_token: "atok".to_owned(),
				kind: crate::auth::SessionKind::Email,
				third_party_user_id: None,
			},
			token: Some(SessionToken {
				session_id: "sid".to_owned(),
				expires_at: u64::MAX,
				restriction: None,
			}),
		}
	}

	#[tokio::test]
	async fn rotate_device_swaps_identity_and_returns_old() {
		let old = DeviceInfo::generate();
		let client = GrindrClient::new(old.clone(), None).unwrap();

		let returned =
			client.rotate_device(DeviceInfo::generate()).await.unwrap();
		assert_eq!(returned.device_id, old.device_id);
		assert_ne!(client.current_device().await.device_id, old.device_id);
	}

	#[tokio::test]
	async fn sign_out_rotating_clears_session_and_rotates_device() {
		let old = DeviceInfo::generate();
		let client =
			GrindrClient::new(old.clone(), Some(fake_session())).unwrap();
		assert!(client.session_receiver().borrow().is_some());

		let returned = client
			.sign_out_rotating(DeviceInfo::generate())
			.await
			.unwrap();

		assert_eq!(returned.device_id, old.device_id);
		assert_ne!(client.current_device().await.device_id, old.device_id);
		assert!(client.session_receiver().borrow().is_none());
	}
}

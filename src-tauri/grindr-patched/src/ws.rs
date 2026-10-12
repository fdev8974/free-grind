use std::sync::Arc;
use std::time::Duration;

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::sync::{broadcast, mpsc, watch};
use tokio::time::sleep;
use wreq::websocket::{Message, WebSocket};

use crate::auth::{AuthState, Session};
use crate::error::GrindrError;
use crate::headers::GrindrHeaders;
use crate::rest::InnerClient;

#[cfg(not(test))]
fn ws_url() -> String {
	"wss://grindr.mobi/v1/ws".to_owned()
}

#[cfg(test)]
fn ws_url() -> String {
	format!(
		"{}/v1/ws",
		crate::testserver::base_url().replacen("http", "ws", 1)
	)
}

const WS_BROADCAST_CAPACITY: usize = 256;

const WS_MAX_MESSAGE_BYTES: usize = 1024 * 1024;

/// The app's okhttp websocket client sets `pingInterval(10, SECONDS)`.
const WS_PING_INTERVAL: Duration = Duration::from_secs(10);

const SEC_WEBSOCKET_EXTENSIONS: &str = "sec-websocket-extensions";

const OKHTTP_WS_EXTENSIONS: &str = "permessage-deflate";

/// A command to send over the websocket.
///
/// The client adds the session token; you set `type`, `ref_id`, and `payload`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WsCommand {
	/// Command type, e.g. `"chat.v1.message.send"`.
	pub r#type: String,
	/// Your id for this command, echoed back in the reply.
	pub ref_id: String,
	/// The command payload.
	pub payload: Value,
}

/// An event received over the websocket.
#[derive(Debug, Clone)]
pub struct WsEvent {
	/// The event's `type` field.
	pub event_type: String,
	/// The full event JSON, including the `type` field.
	pub payload: Value,
}

/// Whether the websocket is connected.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub enum WsConnectionState {
	/// Not connected (signed out, reconnecting, or backing off).
	#[default]
	Disconnected,
	/// Connected and ready to send and receive.
	Connected,
}

pub(crate) struct WsChannels {
	pub event_tx: broadcast::Sender<WsEvent>,
	pub state_tx: watch::Sender<WsConnectionState>,
}

pub(crate) fn make_channels() -> (WsChannels, WsHandles) {
	let (event_tx, _) = broadcast::channel(WS_BROADCAST_CAPACITY);
	let (cmd_tx, cmd_rx) = mpsc::channel(64);
	let (state_tx, state_rx) = watch::channel(WsConnectionState::Disconnected);

	let channels = WsChannels {
		event_tx: event_tx.clone(),
		state_tx,
	};
	let handles = WsHandles {
		cmd_tx,
		cmd_rx,
		state_rx,
	};
	(channels, handles)
}

pub(crate) struct WsHandles {
	pub cmd_tx: mpsc::Sender<WsCommand>,
	pub cmd_rx: mpsc::Receiver<WsCommand>,
	pub state_rx: watch::Receiver<WsConnectionState>,
}

pub(crate) fn spawn_ws_task(
	inner: Arc<InnerClient>,
	auth: Arc<AuthState>,
	channels: WsChannels,
	mut cmd_rx: mpsc::Receiver<WsCommand>,
) {
	tokio::spawn(async move {
		let mut session_rx = auth.session_tx.subscribe();
		let mut active_rx = auth.active_tx.subscribe();
		let mut backoff = Duration::from_secs(1);
		let mut offer_deflate = true;

		loop {
			loop {
				if auth.session.read().await.is_some() {
					break;
				}
				if session_rx.changed().await.is_err() {
					return;
				}
			}

			if !*active_rx.borrow_and_update() {
				let _ = channels.state_tx.send(WsConnectionState::Disconnected);
				if active_rx.wait_for(|active| *active).await.is_err() {
					return;
				}
				backoff = Duration::from_secs(1);
			}

			match connect_and_run(
				&inner,
				&auth,
				&channels,
				&mut cmd_rx,
				&mut session_rx,
				&mut active_rx,
				&mut offer_deflate,
			)
			.await
			{
				Ok(()) => {
					let _ =
						channels.state_tx.send(WsConnectionState::Disconnected);
					backoff = Duration::from_secs(1);
				}
				Err(GrindrError::Auth(_)) => {
					tracing::warn!("[ws] auth error, waiting for next sign-in");
					let _ =
						channels.state_tx.send(WsConnectionState::Disconnected);
					// A backing-off refresh fails without touching the network,
					// so continuing straight on would spin.
					if session_rx.changed().await.is_err() {
						return;
					}
					backoff = Duration::from_secs(1);
				}
				Err(e) => {
					tracing::warn!(
						"[ws] connection error: {e}; retrying in {backoff:?}"
					);
					let _ =
						channels.state_tx.send(WsConnectionState::Disconnected);

					if auth.session.read().await.is_none() {
						backoff = Duration::from_secs(1);
						continue;
					}
					sleep(backoff).await;
					backoff = (backoff * 2).min(Duration::from_secs(30));
				}
			}
		}
	});
}

async fn connect_and_run(
	inner: &InnerClient,
	auth: &AuthState,
	channels: &WsChannels,
	cmd_rx: &mut mpsc::Receiver<WsCommand>,
	session_rx: &mut watch::Receiver<Option<Session>>,
	active_rx: &mut watch::Receiver<bool>,
	offer_deflate: &mut bool,
) -> Result<(), GrindrError> {
	let authorization = crate::auth::authorize(inner, auth).await?.header();

	let fp = inner.fingerprint().await;
	let headers = GrindrHeaders::build(
		&fp.device,
		&fp.user_agent,
		Some(&authorization),
		Some("[FREE]"),
	)?;

	let mut builder = fp
		.ws_http
		.websocket(ws_url())
		.max_message_size(WS_MAX_MESSAGE_BYTES)
		.max_frame_size(WS_MAX_MESSAGE_BYTES);
	for (name, value) in &headers.items {
		builder = builder.header(name.clone(), value.clone());
	}
	if *offer_deflate {
		builder =
			builder.header(SEC_WEBSOCKET_EXTENSIONS, OKHTTP_WS_EXTENSIONS);
	}

	let response = builder
		.send()
		.await
		.map_err(|e| GrindrError::Http(format!("WS connect failed: {e}")))?;

	if *offer_deflate
		&& response.headers().contains_key(SEC_WEBSOCKET_EXTENSIONS)
	{
		*offer_deflate = false;
		return Err(GrindrError::Http(
			"server negotiated permessage-deflate; retrying without the offer"
				.to_owned(),
		));
	}

	let mut ws = response
		.into_websocket()
		.await
		.map_err(|e| GrindrError::Http(format!("WS upgrade failed: {e}")))?;

	let _ = channels.state_tx.send(WsConnectionState::Connected);

	run_message_loop(
		&mut ws,
		cmd_rx,
		auth,
		session_rx,
		active_rx,
		&channels.event_tx,
	)
	.await
}

async fn session_token(auth: &AuthState) -> Option<String> {
	auth.session
		.read()
		.await
		.as_ref()
		.and_then(|s| s.token.as_ref())
		.map(|token| token.session_id.clone())
}

async fn run_message_loop(
	ws: &mut WebSocket,
	cmd_rx: &mut mpsc::Receiver<WsCommand>,
	auth: &AuthState,
	session_rx: &mut watch::Receiver<Option<Session>>,
	active_rx: &mut watch::Receiver<bool>,
	event_tx: &broadcast::Sender<WsEvent>,
) -> Result<(), GrindrError> {
	if session_token(auth).await.is_none() {
		return Ok(());
	}

	let mut ping = tokio::time::interval_at(
		tokio::time::Instant::now() + WS_PING_INTERVAL,
		WS_PING_INTERVAL,
	);
	ping.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);

	loop {
		tokio::select! {
			_ = ping.tick() => {
				ws.send(Message::Ping(Default::default()))
					.await
					.map_err(|e| GrindrError::Http(e.to_string()))?;
			}
			changed = session_rx.changed() => {
				let signed_out = changed.is_err() || session_rx.borrow_and_update().is_none();
				if signed_out {
					return Ok(());
				}
			}
			changed = active_rx.changed() => {
				if changed.is_err() || !*active_rx.borrow_and_update() {
					return Ok(());
				}
			}
			msg = ws.next() => match msg {
				Some(Ok(Message::Text(text))) => {
					if let Ok(payload) = serde_json::from_str::<Value>(text.as_str()) {
						if let Some(event_type) = payload["type"].as_str() {

							let _ = event_tx.send(WsEvent {
								event_type: event_type.to_owned(),
								payload,
							});
						}
					}
				}
				Some(Ok(Message::Ping(data))) => {
					ws.send(Message::Pong(data))
						.await
						.map_err(|e| GrindrError::Http(e.to_string()))?;
				}
				Some(Ok(Message::Close(_))) | None => {
					return Err(GrindrError::Http("WS connection closed by server".to_owned()));
				}
				Some(Err(e)) => {
					return Err(GrindrError::Http(e.to_string()));
				}
				Some(Ok(_)) => {}
			},
			cmd = cmd_rx.recv() => match cmd {
				Some(cmd) => {
					let Some(token) = session_token(auth).await else {
						return Ok(());
					};
					let json = serde_json::json!({
						"type": cmd.r#type,
						"ref":  cmd.ref_id,
						"token": token,
						"payload": cmd.payload,
					});
					ws.send(Message::text(json.to_string()))
						.await
						.map_err(|e| GrindrError::Http(e.to_string()))?;
				}
				None => return Ok(()),
			}
		}
	}
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::device::DeviceInfo;
	use crate::GrindrClient;

	#[tokio::test]
	async fn the_upgrade_offers_the_extension_okhttp_offers() {
		let session = Session {
			credentials: crate::auth::Credentials {
				email: "ws@test.local".to_owned(),
				profile_id: Some("1".to_owned()),
				auth_token: "atok".to_owned(),
				kind: crate::auth::SessionKind::Email,
				third_party_user_id: None,
			},
			token: Some(crate::auth::SessionToken {
				session_id: "sid".to_owned(),
				expires_at: u64::MAX,
				restriction: None,
			}),
		};
		let client =
			GrindrClient::new(DeviceInfo::generate(), Some(session)).unwrap();
		client.connect().await;

		let upgrade = tokio::time::timeout(Duration::from_secs(10), async {
			loop {
				if let Some(seen) =
					crate::testserver::requests_to("/v1/ws").into_iter().next()
				{
					break seen;
				}
				sleep(Duration::from_millis(20)).await;
			}
		})
		.await
		.expect("the client never attempted the upgrade");

		assert_eq!(
			upgrade.header(SEC_WEBSOCKET_EXTENSIONS),
			Some(OKHTTP_WS_EXTENSIONS),
			"the upgrade must offer what RealWebSocket offers"
		);
	}
}

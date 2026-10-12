# grindr.rs

<img src="./contrib/logo.svg" align="right" />

Unofficial async Rust client for the Grindr API, powering [Open Grind](https://opengrind.org) client.

> [!Important]
> This is an **unofficial library**, not affiliated with or endorsed by Grindr.
> It is provided for research and interoperability.
> Automating access may violate Grindr's Terms of Service. You are responsible for how you use it.

## Features

- Async, clonable client built on [`tokio`](https://tokio.rs) and [`wreq`](https://crates.io/crates/wreq)
- Fingerprint matching Grindr's official Android APK's network lib: TLS (JA3/JA4), HTTP/2 (frames, pseudoheaders), required headers
- Session handling — tokens are refreshed automatically
- Background WebSocket with automatic reconnect and states callback
- Device identities spoofing — store DeviceInfo along session token to decrease the chance of triggering Cloudflare block and challenge pages

This crate is a transport: it handles authentication, fingerprinting, connection, but does not ship typed models for every endpoint. You choose the path and deserialize the body yourself.

## Installation

```toml
[dependencies]
grindr = "0.29"
tokio = { version = "1", features = ["macros", "rt-multi-thread", "sync"] }
serde_json = "1"
```

### Versioning

This crate's version is `<lib version>+<Grindr APK version>`. For example, `0.18.0+26.15.1.174557` is library `0.18.0` targeting APK `26.15.1.174557`. The `+<apk>` suffix is [SemVer build metadata](https://semver.org/#spec-item-10): informational only, and ignored by Cargo when resolving versions. Retargeting the APK is treated as a breaking change, so it bumps the minor, requiring manual upgrade. The targeted version is also exposed as `grindr::APP_VERSION`.

## Quick start

```rust
use grindr::{DeviceInfo, GrindrClient, Method};

#[tokio::main]
async fn main() -> Result<(), grindr::GrindrError> {
    let device = DeviceInfo::generate();
    let client = GrindrClient::new(device, None)?;

    let me = client.sign_in_with_email("m@example.com", "yourpassword").await?;
    println!("signed in as profile {}", me.profile_id);

    // URL must start with `/`
    // Session token is added automatically
    // API reference: <https://opengrind.org/grindr-api/>
    // Dev tool: <https://git.opengrind.org/open-grind/grindr-api-dev-tool>
    let resp = client.request(Method::GET, "/v3/me/profile").send().await?;
    println!("status {}", resp.status);
    let profile: serde_json::Value = serde_json::from_slice(&resp.body).unwrap();
    println!("{profile:#?}");

    Ok(())
}
```

## Sessions & device identity

```rust
// Load `device` and `credentials` from disk
let resumed = credentials.map(|credentials| Session { credentials, token: None });
let client = GrindrClient::new(device, resumed)?;

// Persist the durable half whenever it changes
let mut sessions = client.session_receiver();
tokio::spawn(async move {
    while sessions.changed().await.is_ok() {
        // Option<Credentials>
        let current = sessions.borrow().as_ref().map(|s| s.credentials.clone());
        // Serialize to disk and store securely
        save_credentials(&current);
    }
});
```

## WebSocket

The realtime WebSocket is opt-in, REST works without it. Call `client.connect().await` once to start the shared background socket, which then connects as soon as a session exists. Subscribe to events and send commands:

```rust
use grindr::WsCommand;

// Subscribe to events
let mut events = client.ws_receiver();
tokio::spawn(async move {
    while let Ok(event) = events.recv().await {
        println!("event {}: {}", event.event_type, event.payload);
    }
});

// Send a command
client
    .ws_sender()
    .send(WsCommand {
        r#type: "chat.v1.typing_status".to_owned(),
        ref_id: "1".to_owned(),
        payload: serde_json::json!({ "conversationId": "abc" }),
    })
    .await
    .ok();
```

The background task is never started for you. `client.connect().await` is the only thing that starts it, and it's idempotent and shared across clones. Until you call it, no socket is opened and `ws_receiver()` produces nothing. Watch the connection with `GrindrClient::connection_state`, and observe failed background token refreshes via `GrindrClient::auth_event_receiver`.

## API reference

Full generated docs: <https://docs.rs/grindr>.

### `GrindrClient`

All methods are `async` except `new`, `request`, `set_active`, `is_active`, `set_captcha_provider`, `signing_key_receiver`, `session_receiver`, `auth_event_receiver`, `connection_state`, `ws_receiver` and `ws_sender`.

#### Setup and device identity

| Method                                            | Description                                                                                |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `new(device, session) -> Result<Self>`            | Create a client, optionally resuming a stored `Session`. Sync, needs no runtime            |
| `current_device() -> DeviceInfo`                  | The device identity currently in use                                                       |
| `rotate_device(device) -> Result<DeviceInfo>`     | Swap the device identity and transport, keeping the session; returns the old device        |
| `sign_out_rotating(device) -> Result<DeviceInfo>` | `sign_out()` then `rotate_device()`, so the next sign-in can't be correlated with this one |

#### Authentication

| Method                                                                                     | Description                                                                                            |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `sign_in_with_email(email, password) -> Result<SignInResult>`                              | Email + password sign-in                                                                               |
| `sign_in_with_email_at_geohash(email, password, geohash) -> Result<SignInResult>`          | Like `sign_in_with_email`, tagging the sign-in with an approximate location                            |
| `sign_in_with_google(access_token) -> Result<SignInResult>`                                | Google OAuth sign-in                                                                                   |
| `sign_in_with_google_at_geohash(access_token, geohash) -> Result<SignInResult>`            | Like `sign_in_with_google`, with a geohash                                                             |
| `sign_in_with_facebook(access_token) -> Result<SignInResult>`                              | Facebook sign-in                                                                                       |
| `sign_in_with_facebook_at_geohash(access_token, geohash) -> Result<SignInResult>`          | Like `sign_in_with_facebook`, with a geohash                                                           |
| `sign_in_with_third_party_at_geohash(kind, access_token, geohash) -> Result<SignInResult>` | Sign in with any third-party provider token; `kind` picks the vendor, `SessionKind::Email` is rejected |
| `refresh_session() -> Result<SignInResult>`                                                | Force a session refresh (happens automatically otherwise)                                              |
| `refresh_session_at_geohash(geohash) -> Result<SignInResult>`                              | Like `refresh_session`, with a geohash                                                                 |
| `sign_out()`                                                                               | Clear the session and signing key, and close the websocket                                             |
| `recaptcha_first_party_enabled() -> Result<bool>`                                          | Whether the server has first-party reCAPTCHA on. No auth needed                                        |

Only the initial request carries a `geohash`; automatic background refreshes never do.

#### Requests

| Method                                    | Description                                       |
| ----------------------------------------- | ------------------------------------------------- |
| `request(method, path) -> RequestBuilder` | Start a request, sent with the session by default |
| `.json(body)`                             | JSON body; `None` is sent as `null`               |
| `.bytes(content_type, body)`              | Raw binary body                                   |
| `.signed_bytes(content_type, body)`       | Raw binary body signed with the device key        |
| `.stream(content_type, source)`           | Body read from a `BodySource` while it is sent    |
| `.unauthenticated()`                      | Leave out the session headers                     |
| `.send() -> Result<RawResponse>`          | Send and return the response, whatever its status |

`path` must start with `/`, otherwise you get `GrindrError::InvalidRequest`.

#### Media downloads

| Method                                               | Description                                                                                    |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `fetch_media(MediaRequest) -> Result<MediaResponse>` | GET a CDN file with the API's fingerprint on its own pool, with the app's image headers        |
| `stream_media(StreamRequest) -> Result<MediaStream>` | The same GET, handed back once the headers arrive; the body is read piece by piece via `chunk` |

Only `https` on `cdns.grindr.com` or `*.cloudfront.net` is accepted, redirects included; anything else is `GrindrError::InvalidRequest` before a socket is opened. Non-success status returns as `MediaResponse`.

#### Device key

Signed requests register an ephemeral P-256 device key on first use.

| Method                                                                | Description                                                                      |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `register_device_key() -> Result<()>`                                 | Register the device signing key unless one exists                                |
| `restore_signing_key(key) -> bool`                                    | Restore a persisted `DeviceSigningKey`; refused if it belongs to another account |
| `signing_key_receiver() -> watch::Receiver<Option<DeviceSigningKey>>` | Watch the signing key so you can save it                                         |

#### Realtime websocket

| Method                                                     | Description                                                  |
| ---------------------------------------------------------- | ------------------------------------------------------------ |
| `connect()`                                                | Opt in to the websocket and start the shared background task |
| `ws_receiver() -> broadcast::Receiver<WsEvent>`            | Subscribe to websocket events                                |
| `ws_sender() -> mpsc::Sender<WsCommand>`                   | Sender for websocket commands                                |
| `connection_state() -> watch::Receiver<WsConnectionState>` | Watch the websocket connection state                         |

#### Watching session state

| Method                                                    | Description                                                     |
| --------------------------------------------------------- | --------------------------------------------------------------- |
| `session_receiver() -> watch::Receiver<Option<Session>>`  | Watch the current session (updates on sign-in/refresh/sign-out) |
| `auth_event_receiver() -> broadcast::Receiver<AuthEvent>` | Subscribe to background token refresh failures                  |
| `set_active(bool)` / `is_active() -> bool`                | Follow the host app between foreground and background           |
| `reset_transport()`                                       | Drop the connection pool, keeping the device and session        |

### Types

Everything under **Identity and session** and **Requests and errors** — except `RawResponse` — is `#[non_exhaustive]`, so match those enums with a wildcard arm. The **Request bodies and signing** and **Websocket** types are ordinary.

**Identity and session**

- `DeviceInfo` — device identity, build with `DeviceInfo::generate()` or `DeviceInfo::default()`
- `Credentials` — the durable half of a session; the serializable part, persist this. `Debug` redacts `auth_token`. Resume with `Session { credentials, token: None }`
- `Session` — the account's `Credentials` plus the short-lived `SessionToken` once one is minted. `Debug` redacts `session_id`
- `SessionKind` — `Email`, `Google` or `Facebook`
- `SignInResult` — `{ profile_id, restriction }`, returned by the auth methods
- `Restriction` — account restriction from the session JWT, the session is still valid: `AgeVerification { region, reason }` / `TimedBan(BanDetails)` / `TrustVendorRejected` / `Other(String)`
- `VerificationRegion` — `Uk` / `Br` / `Au` / `Us` / `Other`
- `BanDetails` — `{ expiry_time, reason, sub_reason, is_automated }`

**Requests and errors**

- `RawResponse` — `{ status: u16, body: Vec<u8> }`
- `GrindrError` — the crate error type (`Http`, `Connect`, `Timeout(TimeoutPhase)`, `Auth`, `Api`, `Unauthorized`, `Banned`, `RateLimited`, `Blocked(BlockKind)`, `InvalidRequest`, `SessionCleared`, `MediaTooLarge { max_bytes }`); `GrindrError::from_response(status, body)` maps a non-success `RawResponse`
- `TimeoutPhase` — where a request timed out: `Sending` / `Headers` / `Receiving` / `Unfinished`
- `BlockKind` — `Cloudflare` for Cloudflare block page or "Just a moment..." challenge, `Edge` for anything else
- `BanInfo` — `{ kind, code, message, reason, sub_reason, automated }`
- `BanKind` — `Profile` / `Device` / `Network` / `Underage`
- `AuthEvent` — `SignedOut` / `Banned(BanInfo)` / `RefreshFailed { message, kind }` / `RefreshRecovered` from background refreshes
- `RefreshFailureKind` — why a refresh failed: `Transport` / `Blocked` / `RateLimited` / `Server` / `Session`, with `is_transient()`

**Request bodies and signing**

- `RequestBuilder` — built by `request`, sent by `send`
- `BodySource` — trait with `size()` and `open()`, opened again for every attempt
- `DeviceSigningKey` — persistable P-256 device signing key, scoped to one account and device. `Debug` redacts the key

**Timeouts:**

- Most requests: 35 s
- Requests with bytes body: 120 s
- Requests with streamed body: stall timeout
- Media fetches: 20 s for the response headers and 30 s between body chunks
- `fetch_media` times out after 120 s on body

If a media request gets no headers within 20 s over an already-open connection, and nothing else arrived from that host while it waited, the connection is assumed dead, so the request is sent once more on a new connection, and later media requests use new connections too.

**Downloads**

- `MediaRequest` — `{ url, range, max_bytes }` for `fetch_media`
- `MediaResponse` — `{ status, content_type, content_range, accept_ranges, body }`. Size the body using `body.len()`; `Content-Length` is the compressed size and is dropped when decoding
- `StreamRequest` — `{ url, range, fetcher }` for `stream_media`
- `MediaStream` — `{ status, content_type, content_length, content_range, accept_ranges }` plus `chunk() -> Result<Option<Bytes>>`, `None` once the body has ended

**Websocket**

- `WsCommand` — websocket command `{ type, ref_id, payload }`
- `WsEvent` — websocket event `{ event_type, payload }`
- `WsConnectionState` — `Connected` / `Disconnected`

The socket pings every 10 s like the app does, and refuses inbound frames and messages over 1 MiB.

**Re-exports**

- `Method` — re-exported `wreq::Method` for `request`
- `Bytes` — re-exported `bytes::Bytes` for `bytes` and `signed_bytes`

### Low-level helpers

For building your own `wreq::Client` with an identical fingerprint:

- `probe_emulation() -> wreq::EmulationProvider` — tls/http2 emulation profile
- `build_user_agent(device, tier) -> String` — `User-Agent` value
- `build_device_info_header(device) -> String` — `L-Device-Info` value
- `GrindrHeaders::build(device, ua, authorization, roles)` — full and correctly ordered headers list
- `GrindrHeaders::build_media(ua, range)` — the CDN header list `fetch_media` sends
- `APP_VERSION` — the Grindr APK version this crate emulates

## Examples

Observe TLS session resumption:

```sh
cargo run --example warm_probe
```

Assert the emulated fingerprint:

```sh
cargo run --example fingerprint_check
```

The `fingerprint_check` example verifies JA3/JA4, the Akamai http/2 fingerprint and header ordering against [tls.peet.ws](https://tls.peet.ws). Pass `--all` flag to check both http/2 and http/1.1 (websocket) clients.

Register a device key against the live API, with the device persisted across runs:

```sh
EMAIL=... PASSWORD=... cargo run --example device_key_baseline
```

`CAPTCHA_TOKEN`, a reCAPTCHA Enterprise token, is optional; `DEVICE_FILE` defaults to `target/device_key_baseline.json`.

## Minimum supported Rust version

Rust **1.88**.

## License

Code: [MIT](./LICENSE)

Logo: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), adapted from the [Rust logo](https://github.com/rust-lang/rust-artwork) by the Rust Foundation with the Open Grind mask added

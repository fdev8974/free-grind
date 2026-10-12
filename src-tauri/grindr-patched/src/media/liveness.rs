use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::task::{Context, Poll};
use std::time::{Duration, Instant};

use tower_layer::Layer;
use tower_service::Service;
use wreq::dns::{Addrs, Name, Resolve, Resolving};

use crate::error::TimeoutPhase;
use crate::rest::Fingerprint;

#[cfg(test)]
mod tests;

const REARM_AFTER: Duration = Duration::from_secs(120);

#[derive(Debug, Default)]
struct Host {
	last_progress: Option<Instant>,
	dials: u64,
}

#[derive(Debug)]
struct State {
	hosts: HashMap<String, Host>,
	connections: u64,
	named: u64,
	armed: bool,
	retired_at: Option<Instant>,
	generation: u64,
}

#[derive(Debug)]
struct Stamp {
	host: String,
	started: Instant,
	dials: u64,
	unnamed: u64,
	generation: u64,
}

struct Stall<'a> {
	stamp: &'a Stamp,
	phase: TimeoutPhase,
	current: bool,
	redirected: bool,
}

impl State {
	fn new() -> Self {
		Self {
			hosts: HashMap::new(),
			connections: 0,
			named: 0,
			armed: true,
			retired_at: None,
			generation: 0,
		}
	}

	fn stamp(&self, host: &str, now: Instant) -> Stamp {
		Stamp {
			host: host.to_owned(),
			started: now,
			dials: self.hosts.get(host).map_or(0, |host| host.dials),
			unnamed: self.unnamed(),
			generation: self.generation,
		}
	}

	fn unnamed(&self) -> u64 {
		self.connections.saturating_sub(self.named)
	}

	fn connected(&mut self) {
		self.connections += 1;
	}

	fn dialed(&mut self, host: &str) {
		self.hosts.entry(host.to_owned()).or_default().dials += 1;
		self.named += 1;
	}

	fn progressed(&mut self, host: &str, generation: u64, now: Instant) {
		self.hosts.entry(host.to_owned()).or_default().last_progress =
			Some(now);
		if generation == self.generation {
			self.armed = true;
		}
	}

	fn retire(&mut self, stall: &Stall<'_>, now: Instant) -> bool {
		let stamp = stall.stamp;
		let host = self.hosts.get(&stamp.host);
		let quiet = host
			.and_then(|host| host.last_progress)
			.is_none_or(|at| at < stamp.started);
		let pooled = host.map_or(0, |host| host.dials) == stamp.dials
			&& self.unnamed() <= stamp.unnamed
			&& !stall.redirected;
		let armed = self.armed
			|| self.retired_at.is_some_and(|at| {
				now.saturating_duration_since(at) >= REARM_AFTER
			});
		let headers = stall.phase == TimeoutPhase::Headers;
		if !(headers && quiet && pooled && stall.current && armed) {
			return false;
		}
		self.armed = false;
		self.retired_at = Some(now);
		self.generation += 1;
		true
	}
}

/// Media traffic health per CDN host, plus the resolver and connector layer
/// that count dials. A connection the resolver never named, as through a
/// proxy or to an address, could be anyone's, so it rules out a retirement.
#[derive(Debug)]
pub(crate) struct MediaLiveness {
	state: Mutex<State>,
}

/// One media request on the wire, as seen when it started.
pub(crate) struct Attempt {
	fingerprint: Arc<Fingerprint>,
	stamp: Stamp,
	redirected: Arc<AtomicBool>,
}

impl Attempt {
	pub fn resendable_on(&self, current: &Arc<Fingerprint>) -> bool {
		!Arc::ptr_eq(current, &self.fingerprint)
			&& current.device.device_id == self.fingerprint.device.device_id
	}

	/// Set when the request follows a redirect, whose hops are dialed under
	/// other names, so a stall after one never retires the connection.
	pub fn redirect_marker(&self) -> Arc<AtomicBool> {
		Arc::clone(&self.redirected)
	}
}

/// Marks a media response as moving.
#[derive(Debug)]
pub(crate) struct Progress {
	liveness: Arc<MediaLiveness>,
	host: String,
	generation: u64,
}

impl MediaLiveness {
	pub fn new() -> Arc<Self> {
		Arc::new(Self {
			state: Mutex::new(State::new()),
		})
	}

	fn state(&self) -> std::sync::MutexGuard<'_, State> {
		self.state
			.lock()
			.unwrap_or_else(|poison| poison.into_inner())
	}

	pub fn begin(&self, host: &str, fingerprint: Arc<Fingerprint>) -> Attempt {
		Attempt {
			fingerprint,
			stamp: self.state().stamp(host, Instant::now()),
			redirected: Arc::new(AtomicBool::new(false)),
		}
	}

	pub fn answered(
		self: &Arc<Self>,
		attempt: &Attempt,
		host: &str,
	) -> Progress {
		let progress = Progress {
			liveness: Arc::clone(self),
			host: host.to_owned(),
			generation: attempt.stamp.generation,
		};
		progress.record();
		progress
	}

	pub fn retire(
		&self,
		attempt: &Attempt,
		current: &Arc<Fingerprint>,
	) -> bool {
		let stall = Stall {
			stamp: &attempt.stamp,
			phase: TimeoutPhase::Headers,
			current: Arc::ptr_eq(current, &attempt.fingerprint),
			redirected: attempt.redirected.load(Ordering::SeqCst),
		};
		self.state().retire(&stall, Instant::now())
	}

	#[cfg(test)]
	pub fn retirements(&self) -> u64 {
		self.state().generation
	}
}

impl Progress {
	pub fn record(&self) {
		self.liveness.state().progressed(
			&self.host,
			self.generation,
			Instant::now(),
		);
	}
}

#[cfg(not(test))]
fn names_a_cdn(host: &str) -> bool {
	super::is_cdn_host(host)
}

#[cfg(test)]
fn names_a_cdn(host: &str) -> bool {
	super::is_cdn_host(host) || host == "localhost"
}

impl Resolve for MediaLiveness {
	fn resolve(&self, name: Name) -> Resolving {
		let host = name.as_str().to_owned();
		if names_a_cdn(&host) {
			self.state().dialed(&host);
		}
		Box::pin(async move {
			let addrs: Addrs =
				Box::new(tokio::net::lookup_host((host, 0)).await?);
			Ok(addrs)
		})
	}
}

/// Counts every connection the media client opens, named or not.
#[derive(Debug, Clone)]
pub(crate) struct CountConnections(pub Arc<MediaLiveness>);

impl<S> Layer<S> for CountConnections {
	type Service = Counted<S>;

	fn layer(&self, inner: S) -> Counted<S> {
		Counted {
			inner,
			liveness: Arc::clone(&self.0),
		}
	}
}

#[derive(Debug, Clone)]
pub(crate) struct Counted<S> {
	inner: S,
	liveness: Arc<MediaLiveness>,
}

impl<S: Service<R>, R> Service<R> for Counted<S> {
	type Response = S::Response;
	type Error = S::Error;
	type Future = S::Future;

	fn poll_ready(
		&mut self,
		cx: &mut Context<'_>,
	) -> Poll<Result<(), S::Error>> {
		self.inner.poll_ready(cx)
	}

	fn call(&mut self, request: R) -> S::Future {
		self.liveness.state().connected();
		self.inner.call(request)
	}
}

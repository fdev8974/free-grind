use std::future::Future;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use tokio::time::{Instant, MissedTickBehavior};

use crate::client::{Timeouts, CONNECT_TIMEOUT};
use crate::error::{GrindrError, TimeoutPhase};

const CHECKS_PER_STALL: u32 = 120;
const DRAIN_FLOOR_BYTES_PER_SECOND: u64 = 8_000;
const MAX_DRAIN_ALLOWANCE: Duration = Duration::from_secs(10 * 60);

pub(crate) struct WatchedUpload {
	pub sent: Arc<AtomicU64>,
	pub total: u64,
	pub timeouts: Timeouts,
}

struct Watchdog {
	upload: WatchedUpload,
	last_sent: u64,
	deadline: Instant,
}

impl WatchedUpload {
	pub(crate) async fn guard(
		self,
		response: impl Future<Output = Result<wreq::Response, wreq::Error>>,
	) -> Result<wreq::Response, GrindrError> {
		let mut checks =
			tokio::time::interval(self.timeouts.stall / CHECKS_PER_STALL);
		checks.set_missed_tick_behavior(MissedTickBehavior::Delay);
		let mut watchdog = Watchdog::start(self);
		tokio::pin!(response);
		loop {
			tokio::select! {
				biased;
				response = &mut response => return response.map_err(Into::into),
				now = checks.tick() => watchdog.observe(now)?,
			}
		}
	}
}

impl Watchdog {
	fn start(upload: WatchedUpload) -> Self {
		Self {
			deadline: Instant::now() + CONNECT_TIMEOUT + upload.timeouts.stall,
			last_sent: 0,
			upload,
		}
	}

	fn observe(&mut self, now: Instant) -> Result<(), GrindrError> {
		let sent = self.upload.sent.load(Ordering::Relaxed);
		if sent > self.last_sent {
			self.last_sent = sent;
			self.deadline = now
				+ if sent < self.upload.total {
					self.upload.timeouts.stall
				} else {
					self.upload.timeouts.read
						+ drain_allowance(self.upload.total)
				};
		}
		if now < self.deadline {
			return Ok(());
		}
		Err(GrindrError::Timeout(
			if self.last_sent < self.upload.total {
				TimeoutPhase::Sending
			} else {
				TimeoutPhase::Headers
			},
		))
	}
}

fn drain_allowance(body_size: u64) -> Duration {
	Duration::from_millis(
		body_size.saturating_mul(1000) / DRAIN_FLOOR_BYTES_PER_SECOND,
	)
	.min(MAX_DRAIN_ALLOWANCE)
}

#[cfg(test)]
mod tests {
	use super::*;

	const TOTAL: u64 = 16_000;

	fn watchdog() -> Watchdog {
		Watchdog::start(WatchedUpload {
			sent: Arc::default(),
			total: TOTAL,
			timeouts: Timeouts::default(),
		})
	}

	fn timeout_phase(result: Result<(), GrindrError>) -> TimeoutPhase {
		match result {
			Err(GrindrError::Timeout(phase)) => phase,
			other => panic!("expected a timeout, got {other:?}"),
		}
	}

	#[test]
	fn the_drain_allowance_uses_the_floor_rate_up_to_the_cap() {
		assert_eq!(drain_allowance(0), Duration::ZERO);
		assert_eq!(drain_allowance(8_000), Duration::from_secs(1));
		assert_eq!(
			drain_allowance(1024 * 1024),
			Duration::from_millis(131_072)
		);
		assert_eq!(drain_allowance(120 * 1024 * 1024), MAX_DRAIN_ALLOWANCE);
		assert_eq!(drain_allowance(u64::MAX), MAX_DRAIN_ALLOWANCE);
	}

	#[test]
	fn the_first_bytes_may_wait_for_the_connection() {
		let mut watchdog = watchdog();
		let deadline = watchdog.deadline;
		let start = deadline - CONNECT_TIMEOUT - Timeouts::default().stall;

		assert!(watchdog.observe(start + CONNECT_TIMEOUT).is_ok());
		assert_eq!(
			timeout_phase(watchdog.observe(deadline)),
			TimeoutPhase::Sending
		);
	}

	#[test]
	fn a_stall_is_counted_from_the_last_progress() {
		let stall = Timeouts::default().stall;
		let mut watchdog = watchdog();
		let now = Instant::now();

		watchdog.upload.sent.store(TOTAL / 2, Ordering::Relaxed);
		watchdog.observe(now).unwrap();
		assert!(watchdog
			.observe(now + stall - Duration::from_millis(1))
			.is_ok());
		watchdog.upload.sent.store(TOTAL - 1, Ordering::Relaxed);
		watchdog
			.observe(now + stall - Duration::from_millis(1))
			.unwrap();

		assert!(watchdog.observe(now + stall).is_ok());
		assert_eq!(
			timeout_phase(watchdog.observe(now + 2 * stall)),
			TimeoutPhase::Sending
		);
	}

	#[test]
	fn a_whole_body_waits_for_the_read_timeout_plus_the_drain_allowance() {
		let timeouts = Timeouts::default();
		let mut watchdog = watchdog();
		let now = Instant::now();
		let deadline = now + timeouts.read + drain_allowance(TOTAL);

		watchdog.upload.sent.store(TOTAL, Ordering::Relaxed);
		watchdog.observe(now).unwrap();

		assert!(watchdog
			.observe(deadline - Duration::from_millis(1))
			.is_ok());
		assert_eq!(
			timeout_phase(watchdog.observe(deadline)),
			TimeoutPhase::Headers
		);
	}
}

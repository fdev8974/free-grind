use super::*;

const HOST: &str = "cdn.test";
const OTHER_HOST: &str = "other.test";
const DEADLINE: Duration = Duration::from_secs(20);

struct Clock(Instant);

impl Clock {
	fn at(&self, seconds: u64) -> Instant {
		self.0 + Duration::from_secs(seconds)
	}
}

fn dial(state: &mut State, host: &str) {
	state.connected();
	state.dialed(host);
}

fn warmed() -> (State, Clock) {
	let clock = Clock(Instant::now());
	let mut state = State::new();
	dial(&mut state, HOST);
	state.progressed(HOST, 0, clock.at(0));
	(state, clock)
}

fn stall(stamp: &Stamp) -> Stall<'_> {
	Stall {
		stamp,
		phase: TimeoutPhase::Headers,
		current: true,
		redirected: false,
	}
}

fn stalls_at(state: &mut State, started: Instant) -> bool {
	let stamp = state.stamp(HOST, started);
	state.retire(&stall(&stamp), started + DEADLINE)
}

#[test]
fn a_quiet_pooled_connection_is_retired() {
	let (mut state, clock) = warmed();

	assert!(stalls_at(&mut state, clock.at(1)));
	assert_eq!(state.generation, 1);
}

#[test]
fn only_the_header_deadline_retires() {
	for phase in [
		TimeoutPhase::Sending,
		TimeoutPhase::Receiving,
		TimeoutPhase::Unfinished,
	] {
		let (mut state, clock) = warmed();
		let stamp = state.stamp(HOST, clock.at(1));

		let retired = state.retire(
			&Stall {
				phase,
				..stall(&stamp)
			},
			clock.at(21),
		);

		assert!(!retired, "{phase:?} retired the connection");
		assert!(state.retire(&stall(&stamp), clock.at(21)));
	}
}

#[test]
fn progress_from_the_host_during_the_attempt_keeps_the_connection() {
	let (mut state, clock) = warmed();
	let stamp = state.stamp(HOST, clock.at(1));
	state.progressed(OTHER_HOST, 0, clock.at(2));
	assert!(state.retire(&stall(&stamp), clock.at(21)));

	let (mut state, clock) = warmed();
	let stamp = state.stamp(HOST, clock.at(1));
	state.progressed(HOST, 0, clock.at(2));

	assert!(!state.retire(&stall(&stamp), clock.at(21)));
}

#[test]
fn an_attempt_that_dialed_rode_a_new_connection() {
	let (mut state, clock) = warmed();
	let stamp = state.stamp(HOST, clock.at(1));
	dial(&mut state, OTHER_HOST);
	assert!(state.retire(&stall(&stamp), clock.at(21)));

	let (mut state, clock) = warmed();
	let stamp = state.stamp(HOST, clock.at(1));
	dial(&mut state, HOST);

	assert!(!state.retire(&stall(&stamp), clock.at(21)));
}

#[test]
fn a_connection_the_resolver_never_named_could_be_the_attempts_own() {
	let (mut state, clock) = warmed();
	let stamp = state.stamp(HOST, clock.at(1));

	state.connected();

	assert!(!state.retire(&stall(&stamp), clock.at(21)));
}

#[test]
fn a_dial_already_underway_when_the_attempt_began_keeps_it_pooled() {
	let (mut state, clock) = warmed();
	state.connected();
	let stamp = state.stamp(HOST, clock.at(1));

	state.dialed(OTHER_HOST);

	assert!(state.retire(&stall(&stamp), clock.at(21)));
}

#[test]
fn a_redirected_attempt_never_retires() {
	let (mut state, clock) = warmed();
	let stamp = state.stamp(HOST, clock.at(1));

	let retired = state.retire(
		&Stall {
			redirected: true,
			..stall(&stamp)
		},
		clock.at(21),
	);

	assert!(!retired);
	assert!(state.retire(&stall(&stamp), clock.at(21)));
}

#[test]
fn an_attempt_on_a_replaced_transport_retires_nothing() {
	let (mut state, clock) = warmed();
	let stamp = state.stamp(HOST, clock.at(1));

	let retired = state.retire(
		&Stall {
			current: false,
			..stall(&stamp)
		},
		clock.at(21),
	);

	assert!(!retired);
	assert!(state.retire(&stall(&stamp), clock.at(21)));
}

#[test]
fn a_retirement_disarms_until_two_minutes_have_passed() {
	let (mut state, clock) = warmed();
	assert!(stalls_at(&mut state, clock.at(1)));
	dial(&mut state, HOST);

	assert!(!stalls_at(&mut state, clock.at(22)));
	assert!(!stalls_at(&mut state, clock.at(100)));
	assert!(stalls_at(&mut state, clock.at(21 + 120 - 20)));
	assert_eq!(state.generation, 2);
}

#[test]
fn progress_on_the_new_generation_rearms() {
	let (mut state, clock) = warmed();
	assert!(stalls_at(&mut state, clock.at(1)));
	dial(&mut state, HOST);
	state.progressed(HOST, 0, clock.at(22));
	assert!(!stalls_at(&mut state, clock.at(23)));

	state.progressed(HOST, 1, clock.at(44));

	assert!(stalls_at(&mut state, clock.at(45)));
}

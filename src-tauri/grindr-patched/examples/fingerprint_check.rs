//! Usage:
//!
//! ```text
//! cargo run --example fingerprint_check                # h2 cold + h2 warm
//! cargo run --example fingerprint_check -- --ws        # h1 cold + h1 warm
//! cargo run --example fingerprint_check -- --all       # all four (CI flag)
//! cargo run --example fingerprint_check -- --json      # raw JSON dump (cold h2)
//! ```

use std::collections::BTreeMap;
use std::process::ExitCode;

use grindr::{build_user_agent, probe_emulation, DeviceInfo, GrindrHeaders};
use serde_json::Value;
use wreq::Client;

const PROBE_URL: &str = "https://tls.peet.ws/api/all";

// peet.ws's `ja4` field is spec-incorrect: they drop extension `0x0015` — padding,
// so instead we recompute JA4 locally from `json["tls"]["ja4_r"]` after fixing the
// parser bug. Extension list in `json["tls"]["extensions"]` is correct.
//
// Cold-start values, verified
const COLD_JA3_HASH: &str = "1d714db2228763eab228fc28ce7f8e4f";
const COLD_JA4_H2: &str = "t13d1513h2_8daaf6152771_eca864cca44a";
// Guessed value, not verified
const COLD_JA4_H1: &str = "t13d1513h1_8daaf6152771_eca864cca44a";

// Warm-resumption values with `pre_shared_key` extension, verified
const WARM_JA3_HASH: &str = "62e5cbd375390b136bf5b06be231ed6b";
const WARM_JA4_H2: &str = "t13d1514h2_8daaf6152771_fadfdae04b4e";
const WARM_JA4_H1: &str = "t13d1514h1_8daaf6152771_fadfdae04b4e";

// HTTP/2 Akamai fingerprint
const EXPECTED_AKAMAI_H2: &str = "4:16777216|16711681|0|m,p,a,s";
const EXPECTED_PSEUDO_ORDER: &[&str] =
	&[":method", ":path", ":authority", ":scheme"];

const EXPECTED_GRINDR_HEADERS: &[&str] = &[
	"authorization",
	"l-time-zone",
	"l-grindr-roles",
	"l-device-info",
	"accept",
	"user-agent",
	"l-locale",
	"accept-language",
];

// Conscrypt-via-BoringSSL ClientHello extensions, in verified order
const EXPECTED_TLS_EXTENSIONS_COLD: &[&str] = &[
	"server_name",
	"extended_master_secret",
	"renegotiationinfo",
	"supported_groups",
	"ec_point_formats",
	"session_ticket",
	"application_layer_protocol_negotiation",
	"status_request",
	"signature_algorithms",
	"key_share",
	"psk_key_exchange_modes",
	"supported_versions",
	"padding",
];

const EXPECTED_TLS_EXTENSIONS_WARM: &[&str] = &[
	"server_name",
	"extended_master_secret",
	"renegotiationinfo",
	"supported_groups",
	"ec_point_formats",
	"session_ticket",
	"application_layer_protocol_negotiation",
	"status_request",
	"signature_algorithms",
	"key_share",
	"psk_key_exchange_modes",
	"supported_versions",
	"padding",
	"pre_shared_key",
];

#[derive(Clone, Copy)]
struct Mode {
	label: &'static str,
	h1: bool,
}

#[derive(Clone, Copy)]
struct Phase {
	label: &'static str,
	warm: bool,
}

const PHASES: &[Phase] = &[
	Phase {
		label: "cold-start",
		warm: false,
	},
	Phase {
		label: "warm-resumption",
		warm: true,
	},
];

const MODE_H2: Mode = Mode {
	label: "API client (HTTP/2)",
	h1: false,
};
const MODE_H1: Mode = Mode {
	label: "WebSocket client (HTTP/1.1)",
	h1: true,
};

#[tokio::main]
async fn main() -> ExitCode {
	let args: Vec<String> = std::env::args().collect();
	let h1_only = args.iter().any(|a| a == "--ws");
	let all = args.iter().any(|a| a == "--all");

	let modes: Vec<Mode> = match (all, h1_only) {
		(true, _) => vec![MODE_H2, MODE_H1],
		(false, true) => vec![MODE_H1],
		(false, false) => vec![MODE_H2],
	};

	let mut total_failures = 0usize;

	for mode in modes {
		let client = match build_client(mode.h1) {
			Ok(c) => c,
			Err(e) => {
				eprintln!("[{}] build_client failed: {e}", mode.label);
				total_failures += 1;
				continue;
			}
		};

		for phase in PHASES {
			let response = match probe(&client).await {
				Ok(r) => r,
				Err(e) => {
					eprintln!(
						"[{} — {}] probe failed: {e}",
						mode.label, phase.label
					);
					total_failures += 1;
					continue;
				}
			};

			println!("=== {} — {} ===\n", mode.label, phase.label);
			print_human(&response);

			let mut mismatches: Vec<Mismatch> = Vec::new();
			check_tls(&response, mode, *phase, &mut mismatches);
			check_tls_extensions(&response, *phase, &mut mismatches);
			if !mode.h1 {
				check_http2(&response, &mut mismatches);
			}
			check_grindr_header_order(&response, &mut mismatches);

			println!();
			if mismatches.is_empty() {
				println!("PASS ({} — {})\n", mode.label, phase.label);
			} else {
				eprintln!(
					"FAIL ({} — {}) — {} mismatch(es):",
					mode.label,
					phase.label,
					mismatches.len()
				);
				for m in &mismatches {
					eprintln!();
					eprintln!("  {}", m.name);
					eprintln!("    expected: {}", m.expected);
					eprintln!("    actual:   {}", m.actual);
				}
				eprintln!();
				total_failures += 1;
			}
		}
	}

	if total_failures == 0 {
		println!("=== ALL CHECKS PASS ===");
		ExitCode::SUCCESS
	} else {
		eprintln!("=== {total_failures} CHECK(S) FAILED ===");
		ExitCode::FAILURE
	}
}

fn build_client(h1: bool) -> Result<Client, Box<dyn std::error::Error>> {
	let mut builder = Client::builder()
		.emulation(probe_emulation())
		.gzip(true)
		.no_deflate()
		.no_brotli()
		.no_zstd();
	if h1 {
		builder = builder.http1_only();
	}
	Ok(builder.build()?)
}

async fn probe(client: &Client) -> Result<Value, Box<dyn std::error::Error>> {
	let device = DeviceInfo::default();
	let user_agent = build_user_agent(&device, "Free");

	let headers = GrindrHeaders::build(
		&device,
		&user_agent,
		Some("Grindr3 fake-session-for-request"),
		Some("[FREE]"),
	)?;

	let mut req = client.get(PROBE_URL).header("connection", "close");
	for (name, value) in &headers.items {
		req = req.header(name.clone(), value.clone());
	}

	let resp = req.send().await?;
	let json: Value = resp.json().await?;
	Ok(json)
}

fn print_human(r: &Value) {
	println!(
		"# HTTP version: {}",
		r["http_version"].as_str().unwrap_or("?")
	);
	println!();

	println!("# TLS");
	print_field("  ja3", r["tls"]["ja3"].as_str());
	print_field("  ja3_hash", r["tls"]["ja3_hash"].as_str());
	print_field("  ja4 (peet.ws — buggy)", r["tls"]["ja4"].as_str());
	if let Some(ja4_r) = r["tls"]["ja4_r"].as_str() {
		println!("  ja4 (spec-correct): {}", recompute_ja4_spec(ja4_r));
	}
	print_field("  ja4_r", r["tls"]["ja4_r"].as_str());
	println!();

	if let Some(arr) = r["tls"]["ciphers"].as_array() {
		println!("# Cipher suites ({})", arr.len());
		for v in arr {
			println!("    {}", v.as_str().unwrap_or(""));
		}
		println!();
	}

	if let Some(arr) = r["tls"]["extensions"].as_array() {
		println!("# Extensions ({})", arr.len());
		for v in arr {
			if let Some(n) = v.get("name").and_then(|x| x.as_str()) {
				println!("    {n}");
			}
		}
		println!();
	}

	if let Some(http2) = r.get("http2") {
		println!("# HTTP/2");
		print_field("  akamai", http2["akamai_fingerprint"].as_str());
		print_field("  akamai_hash", http2["akamai_fingerprint_hash"].as_str());
		if let Some(arr) = http2["sent_frames"].as_array() {
			for f in arr {
				let ftype = f["frame_type"].as_str().unwrap_or("?");
				println!("  frame: {ftype}");
				match ftype {
					"SETTINGS" => {
						if let Some(s) = f["settings"].as_array() {
							for v in s {
								println!("      {}", v.as_str().unwrap_or(""));
							}
						}
					}
					"WINDOW_UPDATE" => {
						println!("      increment = {}", f["increment"]);
					}
					"HEADERS" => {
						if let Some(h) = f["headers"].as_array() {
							for v in h {
								println!("      {}", v.as_str().unwrap_or(""));
							}
						}
					}
					_ => {}
				}
			}
		}
		println!();
	}

	if let Some(http1) = r.get("http1") {
		println!("# HTTP/1.1");
		if let Some(arr) = http1["headers"].as_array() {
			for v in arr {
				println!("    {}", v.as_str().unwrap_or(""));
			}
		}
		println!();
	}
}

fn print_field(label: &str, v: Option<&str>) {
	if let Some(s) = v {
		println!("{label}: {s}");
	}
}

struct Mismatch {
	name: &'static str,
	expected: String,
	actual: String,
}

fn check_tls(r: &Value, mode: Mode, phase: Phase, m: &mut Vec<Mismatch>) {
	let (expected_ja3, expected_ja4) = match (mode.h1, phase.warm) {
		(false, false) => (COLD_JA3_HASH, COLD_JA4_H2),
		(false, true) => (WARM_JA3_HASH, WARM_JA4_H2),
		(true, false) => (COLD_JA3_HASH, COLD_JA4_H1),
		(true, true) => (WARM_JA3_HASH, WARM_JA4_H1),
	};

	let ja3_hash = r["tls"]["ja3_hash"].as_str().unwrap_or("");
	if ja3_hash != expected_ja3 {
		m.push(Mismatch {
			name: "tls.ja3_hash",
			expected: expected_ja3.into(),
			actual: ja3_hash.into(),
		});
	}

	let ja4_r = r["tls"]["ja4_r"].as_str().unwrap_or("");
	let ja4 = recompute_ja4_spec(ja4_r);
	if ja4 != expected_ja4 {
		m.push(Mismatch {
			name: "tls.ja4 (recomputed, spec-correct)",
			expected: expected_ja4.into(),
			actual: ja4,
		});
	}
}

fn recompute_ja4_spec(ja4_r: &str) -> String {
	let parts: Vec<&str> = ja4_r.split('_').collect();
	if parts.len() != 4 {
		return ja4_r.to_owned();
	}
	let a_part = parts[0];
	let ciphers = parts[1];
	let exts_str = parts[2];
	let sigalgs = parts[3];

	let mut exts: Vec<&str> = exts_str.split(',').collect();
	if !exts.contains(&"0015") {
		exts.push("0015");
		exts.sort();
	}
	let exts_fixed = exts.join(",");

	let ja4_b = sha256_truncated(ciphers);
	let ja4_c = sha256_truncated(&format!("{exts_fixed}_{sigalgs}"));

	format!("{a_part}_{ja4_b}_{ja4_c}")
}

fn sha256_truncated(s: &str) -> String {
	use sha2::{Digest, Sha256};
	let digest = Sha256::digest(s.as_bytes());
	hex_encode(&digest[..6])
}

fn hex_encode(bytes: &[u8]) -> String {
	let mut s = String::with_capacity(bytes.len() * 2);
	for b in bytes {
		s.push_str(&format!("{b:02x}"));
	}
	s
}

fn check_tls_extensions(r: &Value, phase: Phase, m: &mut Vec<Mismatch>) {
	let actual: Vec<String> = r["tls"]["extensions"]
		.as_array()
		.map(|a| {
			a.iter()
				.filter_map(|v| v.get("name").and_then(|x| x.as_str()))
				.map(short_ext_name)
				.collect()
		})
		.unwrap_or_default();

	let expected: &[&str] = if phase.warm {
		EXPECTED_TLS_EXTENSIONS_WARM
	} else {
		EXPECTED_TLS_EXTENSIONS_COLD
	};
	let expected_owned: Vec<String> =
		expected.iter().map(|s| s.to_string()).collect();

	if actual != expected_owned {
		m.push(Mismatch {
			name: "tls.extensions_order",
			expected: expected.join(", "),
			actual: actual.join(", "),
		});
	}
}

/// `"server_name (0)"` -> `"server_name"`,
/// `"extensionRenegotiationInfo (boringssl) (65281)"` -> `"renegotiationinfo"`.
fn short_ext_name(s: &str) -> String {
	let no_paren = s.split(" (").next().unwrap_or(s).trim();
	no_paren
		.strip_prefix("extension")
		.unwrap_or(no_paren)
		.to_lowercase()
}

fn check_http2(r: &Value, m: &mut Vec<Mismatch>) {
	let akamai = r["http2"]["akamai_fingerprint"].as_str().unwrap_or("");
	if akamai != EXPECTED_AKAMAI_H2 {
		m.push(Mismatch {
			name: "http2.akamai_fingerprint",
			expected: EXPECTED_AKAMAI_H2.into(),
			actual: akamai.into(),
		});
	}

	let frames = r["http2"]["sent_frames"].as_array();
	let first_headers = frames
		.and_then(|f| f.iter().find(|x| x["frame_type"] == "HEADERS"))
		.and_then(|x| x["headers"].as_array());

	if let Some(headers) = first_headers {
		let names: Vec<String> = headers
			.iter()
			.filter_map(|v| v.as_str())
			.map(header_name)
			.collect();
		let pseudo: Vec<&str> = names
			.iter()
			.take_while(|n| n.starts_with(':'))
			.map(String::as_str)
			.collect();
		let expected_pseudo: Vec<String> = EXPECTED_PSEUDO_ORDER
			.iter()
			.map(|s| s.to_string())
			.collect();
		if pseudo.iter().map(|s| s.to_string()).collect::<Vec<_>>()
			!= expected_pseudo
		{
			m.push(Mismatch {
				name: "http2.pseudo_header_order",
				expected: EXPECTED_PSEUDO_ORDER.join(", "),
				actual: pseudo.join(", "),
			});
		}
	}
}

fn check_grindr_header_order(r: &Value, m: &mut Vec<Mismatch>) {
	let h2_headers = r["http2"]["sent_frames"]
		.as_array()
		.and_then(|f| f.iter().find(|x| x["frame_type"] == "HEADERS"))
		.and_then(|x| x["headers"].as_array());
	let h1_headers = r["http1"]["headers"].as_array();
	let headers = h2_headers.or(h1_headers);

	let actual_names: Vec<String> = headers
		.map(|h| {
			h.iter()
				.filter_map(|v| v.as_str())
				.map(header_name)
				.collect()
		})
		.unwrap_or_default();

	let mut indices: BTreeMap<&str, Option<usize>> = BTreeMap::new();
	for name in EXPECTED_GRINDR_HEADERS {
		let idx = actual_names.iter().position(|n| n == name);
		indices.insert(name, idx);
	}

	let missing: Vec<&str> = indices
		.iter()
		.filter_map(|(k, v)| v.is_none().then_some(*k))
		.collect();
	if !missing.is_empty() {
		m.push(Mismatch {
			name: "grindr_headers.missing",
			expected: EXPECTED_GRINDR_HEADERS.join(", "),
			actual: format!("missing: {}", missing.join(", ")),
		});
		return;
	}

	let positions: Vec<usize> = EXPECTED_GRINDR_HEADERS
		.iter()
		.filter_map(|n| indices.get(n).copied().flatten())
		.collect();
	let sorted: Vec<usize> = {
		let mut s = positions.clone();
		s.sort();
		s
	};
	if positions != sorted {
		let actual_subseq: Vec<&str> = positions
			.iter()
			.map(|&i| actual_names[i].as_str())
			.collect();
		m.push(Mismatch {
			name: "grindr_headers.order",
			expected: EXPECTED_GRINDR_HEADERS.join(" → "),
			actual: actual_subseq.join(" → "),
		});
	}
}

/// `":method: GET"` -> `":method"`
/// `"user-agent: foo"` -> `"user-agent"`.
fn header_name(s: &str) -> String {
	let idx = s.find(": ").unwrap_or(s.len());
	s[..idx].to_lowercase()
}

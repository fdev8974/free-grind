use grindr::probe_emulation;
use wreq::Client;

#[tokio::main]
async fn main() {
	let client = Client::builder()
		.emulation(probe_emulation())
		.gzip(true)
		.no_deflate()
		.no_brotli()
		.no_zstd()
		.build()
		.expect("build");

	for i in 1..=3 {
		let resp = client
			.get("https://tls.peet.ws/api/all")
			.header("connection", "close")
			.send()
			.await
			.expect("send");
		let json: serde_json::Value = resp.json().await.expect("json");
		let ja3 = json["tls"]["ja3"].as_str().unwrap_or("?");
		let ja3_hash = json["tls"]["ja3_hash"].as_str().unwrap_or("?");
		let ja4 = json["tls"]["ja4"].as_str().unwrap_or("?");
		let ext_count: usize = json["tls"]["extensions"]
			.as_array()
			.map(|a| a.len())
			.unwrap_or(0);
		let has_psk = json["tls"]["extensions"]
			.as_array()
			.map(|a| {
				a.iter().any(|e| {
					e.get("name")
						.and_then(|x| x.as_str())
						.unwrap_or("")
						.starts_with("pre_shared_key")
				})
			})
			.unwrap_or(false);
		println!("probe {i}: ja3_hash={ja3_hash} ja4={ja4} ext={ext_count} psk={has_psk}");
		println!("         ja3={ja3}");
	}
}

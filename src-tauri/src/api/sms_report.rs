//! A plain-text report of the last SMS verification exchange, for users to
//! copy from the verification page and send along with a bug report.

use std::fmt::Write as _;
use std::sync::Mutex;

static LAST_REPORT: Mutex<Option<String>> = Mutex::new(None);

// Enough for an error page; a longer body is cut.
const MAX_BODY_CHARS: usize = 4000;

/// Keeps the report of an exchange that got a response.
pub fn record_exchange(exchange: &grindr::SmsExchange) {
    store(format_exchange(exchange));
}

/// Keeps the report of a request that got no response at all.
pub fn record_failure(action: &str, error: &grindr::GrindrError) {
    let mut report = header();
    let _ = writeln!(report, "Action: {action}");
    let _ = writeln!(report, "No response: {error:?}");
    store(report);
}

fn store(report: String) {
    *LAST_REPORT.lock().unwrap_or_else(|e| e.into_inner()) = Some(report);
}

fn header() -> String {
    format!("Time (UTC): {}\n", chrono::Utc::now().format("%Y-%m-%d %H:%M:%S"))
}

fn format_exchange(exchange: &grindr::SmsExchange) -> String {
    let mut report = header();
    let _ = writeln!(report, "Request: POST {}", exchange.path);
    let _ = writeln!(report, "Request headers:");
    for (name, value) in &exchange.request_headers {
        let _ = writeln!(report, "  {name}: {value}");
    }
    let _ = writeln!(report, "Request body: {}", masked_body(&exchange.request_body));
    let _ = writeln!(report);
    let _ = writeln!(report, "Response status: {}", exchange.status);
    let _ = writeln!(report, "Response headers:");
    for (name, value) in &exchange.response_headers {
        let _ = writeln!(report, "  {name}: {value}");
    }
    let _ = writeln!(report, "Response body ({} bytes):", exchange.response_body.len());
    let _ = writeln!(report, "{}", body_text(&exchange.response_body));
    let _ = writeln!(report);
    match &exchange.result {
        Ok(answer) => {
            let _ = writeln!(report, "Result: ok, code {:?}, message {:?}", answer.code, answer.message);
        }
        Err(error) => {
            let _ = writeln!(report, "Result: {error:?}");
        }
    }
    report
}

/// The phone number down to its last three digits, the code hidden.
fn masked_body(body: &str) -> String {
    let Ok(serde_json::Value::Object(mut fields)) = serde_json::from_str(body) else {
        return "(not JSON, left out)".to_owned();
    };
    if let Some(serde_json::Value::String(number)) = fields.get_mut("phone_number") {
        *number = mask_digits(number);
    }
    if let Some(serde_json::Value::String(code)) = fields.get_mut("code") {
        *code = "*".repeat(code.chars().count());
    }
    serde_json::Value::Object(fields).to_string()
}

fn mask_digits(number: &str) -> String {
    let shown = 3;
    let count = number.chars().count();
    number
        .chars()
        .enumerate()
        .map(|(i, c)| if i + shown < count { '*' } else { c })
        .collect()
}

fn body_text(body: &[u8]) -> String {
    let text = String::from_utf8_lossy(body);
    if text.trim().is_empty() {
        return "(empty)".to_owned();
    }
    let mut cut: String = text.chars().take(MAX_BODY_CHARS).collect();
    if cut.len() < text.len() {
        cut.push_str("\n(cut)");
    }
    cut
}

/// The report of the last SMS send or verify attempt, if any.
#[tauri::command]
pub fn sms_debug_report() -> Option<String> {
    LAST_REPORT.lock().unwrap_or_else(|e| e.into_inner()).clone()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_body_keeps_only_the_last_three_digits_and_hides_the_code() {
        let masked = masked_body(r#"{"country_code":"49","phone_number":"1701234567","code":"123456"}"#);
        let value: serde_json::Value = serde_json::from_str(&masked).unwrap();
        assert_eq!(value["country_code"], "49");
        assert_eq!(value["phone_number"], "*******567");
        assert_eq!(value["code"], "******");
    }

    #[test]
    fn a_short_number_is_shown_as_it_is() {
        assert_eq!(mask_digits("12"), "12");
    }

    #[test]
    fn an_empty_body_says_so() {
        assert_eq!(body_text(b"  \n"), "(empty)");
    }
}

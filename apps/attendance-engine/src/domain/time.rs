//! Time handling. The engine never reads a clock: every instant is an explicit input.
//!
//! * `kuwait_work_date` mirrors `toKuwaitWorkDate` (fixed UTC+3, no DST).
//! * `mobile_intake` mirrors the TIME-01 part of `AttendancePunchesService.createMobile`: the
//!   official instant is the server receipt time; the phone clock is diagnostic only.

use chrono::{DateTime, Duration, NaiveDate, SecondsFormat, Utc};
use serde::Deserialize;
use serde_json::{Map, Value};

use super::geo::js_round;
use super::types::PunchType;

pub const KUWAIT_UTC_OFFSET_HOURS: i64 = 3;
/// `CLIENT_CLOCK_SKEW_FLAG_SECONDS` in `attendance-validation.constants.ts`.
pub const CLIENT_CLOCK_SKEW_FLAG_SECONDS: i64 = 300;
pub const INTAKE_FLAG_SOURCE: &str = "INTAKE";

pub fn kuwait_work_date(instant: DateTime<Utc>) -> NaiveDate {
    (instant + Duration::hours(KUWAIT_UTC_OFFSET_HOURS)).date_naive()
}

/// JavaScript `Date.prototype.toISOString` format (millisecond precision, `Z`).
pub fn to_iso_millis(instant: DateTime<Utc>) -> String {
    instant.to_rfc3339_opts(SecondsFormat::Millis, true)
}

/// The mobile request as sent by the app (`CreateMobilePunchDto`, already DTO-validated).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MobileIntakeRequest {
    pub punch_type: PunchType,
    #[serde(default)]
    pub client_reported_time: Option<String>,
    /// Legacy pre-TIME-01 field — diagnostic only, exactly like `client_reported_time`.
    #[serde(default)]
    pub punch_time_source: Option<String>,
    #[serde(default)]
    pub client_request_id: Option<String>,
    #[serde(default)]
    pub latitude: Option<f64>,
    #[serde(default)]
    pub longitude: Option<f64>,
    #[serde(default)]
    pub gps_accuracy: Option<f64>,
    #[serde(default)]
    pub work_location_id: Option<String>,
    pub device_identifier: String,
    #[serde(default)]
    pub fraud_signals: Option<Value>,
    #[serde(default)]
    pub app_version: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct IntakeTimestamps {
    /// Official instant (= server receipt time).
    pub punch_time_source: DateTime<Utc>,
    /// Parsed phone clock, millisecond precision (like a JS `Date`), if parseable.
    pub client_reported_time: Option<DateTime<Utc>>,
    /// Flags written at intake, in NestJS order.
    pub intake_flags: Vec<Value>,
}

fn intake_flag(flag: &str, details: &[(&str, Value)]) -> Value {
    let mut object = Map::new();
    object.insert("source".into(), Value::from(INTAKE_FLAG_SOURCE));
    object.insert("flag".into(), Value::from(flag));
    for (key, value) in details {
        object.insert((*key).into(), value.clone());
    }
    Value::Object(object)
}

/// Strict RFC 3339 parse, truncated to milliseconds as a JS `Date` would hold it.
fn parse_client_instant(raw: &str) -> Option<DateTime<Utc>> {
    let parsed = DateTime::parse_from_rfc3339(raw).ok()?.with_timezone(&Utc);
    DateTime::from_timestamp_millis(parsed.timestamp_millis())
}

/// TIME-01 intake. `server_received_at` is the trusted receipt time and is the ONLY input that
/// can become `punch_time_source`; nothing in `request` can move it.
pub fn mobile_intake(
    server_received_at: DateTime<Utc>,
    request: &MobileIntakeRequest,
) -> IntakeTimestamps {
    let mut flags = Vec::new();
    if let Some(signals) = request.fraud_signals.as_ref().filter(|v| v.is_object()) {
        let mut object = Map::new();
        object.insert("flag".into(), Value::from("CLIENT_REPORTED_SIGNALS"));
        object.insert("signals".into(), signals.clone());
        flags.push(Value::Object(object));
    }

    let submitted = request
        .client_reported_time
        .as_deref()
        .or(request.punch_time_source.as_deref());
    let client_reported_time = submitted.and_then(parse_client_instant);
    if submitted.is_some() && client_reported_time.is_none() {
        flags.push(intake_flag("CLIENT_TIME_UNPARSEABLE", &[]));
    }
    if let Some(client) = client_reported_time {
        let skew_ms = (client.timestamp_millis() - server_received_at.timestamp_millis()) as f64;
        let skew_seconds = js_round(skew_ms / 1000.0) as i64;
        if skew_seconds.abs() > CLIENT_CLOCK_SKEW_FLAG_SECONDS {
            flags.push(intake_flag(
                "CLIENT_CLOCK_SKEW",
                &[("skewSeconds", Value::from(skew_seconds))],
            ));
        }
    }
    if request.client_request_id.is_none() {
        flags.push(intake_flag("LEGACY_CLIENT_NO_REQUEST_ID", &[]));
    }

    IntakeTimestamps {
        punch_time_source: server_received_at,
        client_reported_time,
        intake_flags: flags,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(s: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(s).unwrap().with_timezone(&Utc)
    }

    #[test]
    fn kuwait_boundary() {
        assert_eq!(
            kuwait_work_date(at("2026-11-08T20:59:59.999Z")).to_string(),
            "2026-11-08"
        );
        assert_eq!(
            kuwait_work_date(at("2026-11-08T21:00:00.000Z")).to_string(),
            "2026-11-09"
        );
    }

    fn request(client: Option<&str>) -> MobileIntakeRequest {
        MobileIntakeRequest {
            punch_type: PunchType::In,
            client_reported_time: client.map(str::to_owned),
            punch_time_source: None,
            client_request_id: Some("6f1c2d64-6c55-4f7e-9d0e-4c7a9b8b2a11".into()),
            latitude: None,
            longitude: None,
            gps_accuracy: None,
            work_location_id: None,
            device_identifier: "d".into(),
            fraud_signals: None,
            app_version: None,
        }
    }

    #[test]
    fn client_clock_never_becomes_official() {
        let server = at("2026-11-08T06:00:00.000Z");
        for client in [
            "2026-11-08T05:30:00.000Z",
            "2030-01-01T00:00:00+14:00",
            "1999-01-01T00:00:00Z",
        ] {
            let result = mobile_intake(server, &request(Some(client)));
            assert_eq!(result.punch_time_source, server, "{client}");
        }
    }

    #[test]
    fn skew_threshold_is_strictly_greater_than_300_seconds() {
        let server = at("2026-11-08T06:00:00.000Z");
        assert!(
            mobile_intake(server, &request(Some("2026-11-08T06:05:00.000Z")))
                .intake_flags
                .is_empty()
        );
        assert_eq!(
            mobile_intake(server, &request(Some("2026-11-08T06:05:01.000Z")))
                .intake_flags
                .len(),
            1
        );
    }
}

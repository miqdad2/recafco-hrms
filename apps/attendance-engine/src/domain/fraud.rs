//! Fraud flags and weights — identical to `FRAUD_WEIGHTS`, `pushFlag`, `extractNonEngineFlags`,
//! `toFlagArray` and `hasFraudSignal` in `AttendanceValidationService`.

use serde_json::{Map, Value};

pub const ENGINE_FLAG_SOURCE: &str = "VALIDATION_ENGINE";

pub mod weight {
    pub const EMPLOYEE_INACTIVE: i64 = 100;
    pub const DUPLICATE_PUNCH: i64 = 80;
    pub const UNAPPROVED_DEVICE: i64 = 80;
    pub const FAKE_GPS_SIGNAL: i64 = 90;
    pub const OUTSIDE_GEOFENCE: i64 = 70;
    pub const INACTIVE_WORK_LOCATION: i64 = 40;
    pub const POOR_GPS_ACCURACY: i64 = 30;
    pub const MISSING_LOCATION_DATA: i64 = 20;
    pub const MOBILE_PUNCHING_NOT_ALLOWED: i64 = 50;
    pub const MISSING_MANUAL_REASON: i64 = 50;
}

/// Client fraud-signal keys, compared lower-cased (TIME-01 list, incl. `mocklocationdetected`).
const SUSPICIOUS_SIGNAL_KEYS: [&str; 9] = [
    "mocklocation",
    "mocklocationdetected",
    "mocked",
    "ismocked",
    "fakegps",
    "isrooted",
    "isjailbroken",
    "rooted",
    "jailbroken",
];

/// `{ source: 'VALIDATION_ENGINE', flag, ...details }`.
pub fn engine_flag(flag: &str, details: &[(&str, Value)]) -> Value {
    let mut object = Map::new();
    object.insert("source".into(), Value::from(ENGINE_FLAG_SOURCE));
    object.insert("flag".into(), Value::from(flag));
    for (key, value) in details {
        object.insert((*key).into(), value.clone());
    }
    Value::Object(object)
}

/// `toFlagArray`: only object entries count.
pub fn flag_objects(flags: &[Value]) -> impl Iterator<Item = &Value> {
    flags.iter().filter(|f| f.is_object())
}

/// `extractNonEngineFlags`: keeps every object flag whose `source` is not the engine's.
pub fn preserved_flags(existing: &[Value]) -> Vec<Value> {
    flag_objects(existing)
        .filter(|f| f.get("source").and_then(Value::as_str) != Some(ENGINE_FLAG_SOURCE))
        .cloned()
        .collect()
}

/// `hasFraudSignal`: any `CLIENT_REPORTED_SIGNALS` entry whose `signals` object has a suspicious
/// key with value strictly `true` (a string `"true"` does NOT count — existing behaviour).
pub fn has_client_fraud_signal(existing: &[Value]) -> bool {
    flag_objects(existing)
        .filter(|f| f.get("flag").and_then(Value::as_str) == Some("CLIENT_REPORTED_SIGNALS"))
        .filter_map(|f| f.get("signals").and_then(Value::as_object))
        .any(|signals| {
            signals.iter().any(|(key, value)| {
                SUSPICIOUS_SIGNAL_KEYS.contains(&key.to_lowercase().as_str())
                    && value == &Value::Bool(true)
            })
        })
}

pub fn has_flag(flags: &[Value], name: &str) -> bool {
    flag_objects(flags).any(|f| f.get("flag").and_then(Value::as_str) == Some(name))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn mock_signal_requires_boolean_true_and_known_key() {
        let flags =
            |signals: Value| vec![json!({"flag": "CLIENT_REPORTED_SIGNALS", "signals": signals})];
        assert!(has_client_fraud_signal(&flags(
            json!({"mockLocationDetected": true})
        )));
        assert!(has_client_fraud_signal(&flags(json!({"IsMocked": true}))));
        assert!(!has_client_fraud_signal(&flags(
            json!({"mockLocationDetected": "true"})
        )));
        assert!(!has_client_fraud_signal(&flags(
            json!({"mockLocationDetected": false})
        )));
        assert!(!has_client_fraud_signal(&flags(
            json!({"somethingElse": true})
        )));
        assert!(!has_client_fraud_signal(&[
            json!({"flag": "OTHER", "signals": {"mocked": true}})
        ]));
    }

    #[test]
    fn preserved_flags_drop_only_engine_flags() {
        let existing = vec![
            json!({"flag": "CLIENT_REPORTED_SIGNALS"}),
            json!({"source": "VALIDATION_ENGINE", "flag": "OUTSIDE_GEOFENCE"}),
            json!({"source": "INTAKE", "flag": "CLIENT_CLOCK_SKEW"}),
            json!("not-an-object"),
        ];
        let kept = preserved_flags(&existing);
        assert_eq!(kept.len(), 2);
        assert_eq!(kept[1]["flag"], "CLIENT_CLOCK_SKEW");
    }
}

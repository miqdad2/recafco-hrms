//! RUST-02 Rust side of the validation parity check.
//!
//! Runs every scenario in `packages/attendance-test-vectors/validation-v1.scenarios.json` through
//! the pure Rust engine and compares the outcome with `validation-v1.expected.json` (recorded from
//! the unmodified NestJS implementation and reviewed). Comparison rules are identical to
//! `parity-compare.cjs`: exact business fields, numbers by value, flags as a canonical multiset
//! with order checked, and only `distanceFromLocationMeters` within 1e-6 m.
//!
//! Also writes `target/parity/rust-results.json` for the direct NestJS↔Rust cross-check.

use std::collections::BTreeMap;
use std::path::PathBuf;

use recafco_attendance_engine::domain::{
    MobileIntakeInput, RESULT_CONTRACT_VERSION, RULESET_VERSION, ValidationInput, validate,
    validate_mobile_intake,
};
use serde::Deserialize;
use serde_json::{Map, Value, json};

const DISTANCE_TOLERANCE_METERS: f64 = 1e-6;
const EXACT_FIELDS: [&str; 6] = [
    "validationStatus",
    "fraudScore",
    "duplicateOfPunchId",
    "workDate",
    "punchTimeSource",
    "clientReportedTime",
];

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ScenarioDoc {
    ruleset_version: String,
    result_contract_version: String,
    scenarios: Vec<Scenario>,
}

#[derive(Deserialize)]
struct Scenario {
    id: String,
    kind: String,
    input: Value,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExpectedDoc {
    ruleset_version: String,
    outcomes: BTreeMap<String, Value>,
}

fn vectors_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../packages/attendance-test-vectors")
}

/// Integral floats become integers so `250` and `250.0` compare equal; objects keep sorted keys.
fn normalize(value: &Value) -> Value {
    match value {
        Value::Number(n) => match n.as_f64() {
            Some(f) if f.fract() == 0.0 && f.abs() < 9.0e15 => json!(f as i64),
            Some(f) => json!(f),
            None => value.clone(),
        },
        Value::Array(items) => Value::Array(items.iter().map(normalize).collect()),
        Value::Object(map) => Value::Object(
            map.iter()
                .map(|(k, v)| (k.clone(), normalize(v)))
                .collect::<Map<_, _>>(),
        ),
        other => other.clone(),
    }
}

fn canonical(value: &Value) -> String {
    serde_json::to_string(&normalize(value)).expect("serializable")
}

fn field<'a>(outcome: &'a Value, name: &str) -> &'a Value {
    outcome.get(name).unwrap_or(&Value::Null)
}

/// Returns the list of differing fields (empty = identical) and whether flag order matched.
fn compare(expected: &Value, actual: &Value) -> (Vec<String>, bool) {
    let mut differences = Vec::new();
    for name in EXACT_FIELDS {
        if normalize(field(expected, name)) != normalize(field(actual, name)) {
            differences.push(format!(
                "{name}: expected {} got {}",
                field(expected, name),
                field(actual, name)
            ));
        }
    }

    let (ed, ad) = (
        field(expected, "distanceFromLocationMeters").as_f64(),
        field(actual, "distanceFromLocationMeters").as_f64(),
    );
    let distance_ok = match (ed, ad) {
        (None, None) => true,
        (Some(e), Some(a)) => (e - a).abs() <= DISTANCE_TOLERANCE_METERS,
        _ => false,
    };
    if !distance_ok {
        differences.push(format!(
            "distanceFromLocationMeters: expected {ed:?} got {ad:?}"
        ));
    }

    let flags = |v: &Value| {
        v.get("fraudFlags")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default()
    };
    let ef: Vec<String> = flags(expected).iter().map(canonical).collect();
    let af: Vec<String> = flags(actual).iter().map(canonical).collect();
    let (mut se, mut sa) = (ef.clone(), af.clone());
    se.sort();
    sa.sort();
    if se != sa {
        differences.push(format!("fraudFlags: expected {ef:?} got {af:?}"));
    }
    (differences, ef == af)
}

#[test]
fn rust_engine_matches_recorded_nestjs_outcomes_for_every_scenario() {
    let scenarios: ScenarioDoc = serde_json::from_str(
        &std::fs::read_to_string(vectors_dir().join("validation-v1.scenarios.json")).unwrap(),
    )
    .unwrap();
    let expected: ExpectedDoc = serde_json::from_str(
        &std::fs::read_to_string(vectors_dir().join("validation-v1.expected.json")).unwrap(),
    )
    .unwrap();

    assert_eq!(
        scenarios.ruleset_version, RULESET_VERSION,
        "scenario file targets a different ruleset"
    );
    assert_eq!(
        expected.ruleset_version, RULESET_VERSION,
        "expected file targets a different ruleset"
    );
    assert_eq!(scenarios.result_contract_version, RESULT_CONTRACT_VERSION);

    let mut results = BTreeMap::new();
    let mut failures = Vec::new();
    for scenario in &scenarios.scenarios {
        let outcome = match scenario.kind.as_str() {
            "validation" => {
                let input: ValidationInput = serde_json::from_value(scenario.input.clone())
                    .unwrap_or_else(|e| panic!("{}: bad validation input: {e}", scenario.id));
                validate(&input)
            }
            "mobileIntake" => {
                let input: MobileIntakeInput = serde_json::from_value(scenario.input.clone())
                    .unwrap_or_else(|e| panic!("{}: bad intake input: {e}", scenario.id));
                validate_mobile_intake(&input)
            }
            other => panic!("{}: unknown scenario kind {other}", scenario.id),
        };
        let actual = serde_json::to_value(&outcome).unwrap();

        match expected.outcomes.get(&scenario.id) {
            None => failures.push(format!("{}: no expected outcome recorded", scenario.id)),
            Some(want) => {
                let (differences, order_ok) = compare(want, &actual);
                if !differences.is_empty() {
                    failures.push(format!("{}: {}", scenario.id, differences.join("; ")));
                } else if !order_ok {
                    failures.push(format!(
                        "{}: flags equal as a set but in a different order",
                        scenario.id
                    ));
                }
            }
        }
        results.insert(scenario.id.clone(), actual);
    }

    let out_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("target/parity");
    std::fs::create_dir_all(&out_dir).unwrap();
    let document = json!({
        "producer": "rust",
        "rulesetVersion": RULESET_VERSION,
        "resultContractVersion": RESULT_CONTRACT_VERSION,
        "outcomes": results,
    });
    std::fs::write(
        out_dir.join("rust-results.json"),
        serde_json::to_string_pretty(&document).unwrap(),
    )
    .unwrap();

    assert!(
        failures.is_empty(),
        "{} of {} scenarios differ from NestJS:\n{}",
        failures.len(),
        scenarios.scenarios.len(),
        failures.join("\n")
    );
    assert_eq!(
        results.len(),
        expected.outcomes.len(),
        "scenario/expected count mismatch"
    );
}

#[test]
fn employee_row_missing_is_rejected_like_nestjs_not_found() {
    // Not representable through NestJS (FK), so covered here: `employee?.status ?? 'NOT_FOUND'`.
    let input: ValidationInput = serde_json::from_value(json!({
        "punch": {"id": "p", "punchType": "IN", "sourceType": "BIOMETRIC_DEVICE",
                  "punchTimeSource": "2026-11-08T06:00:00.000Z", "attendanceDeviceId": "bio-1"},
        "employee": null
    }))
    .unwrap();
    let outcome = validate(&input);
    assert_eq!(
        serde_json::to_value(outcome.validation_status).unwrap(),
        "REJECTED_EMPLOYEE_INACTIVE"
    );
    assert_eq!(outcome.fraud_score, 100);
    assert_eq!(outcome.fraud_flags[0]["employeeStatus"], "NOT_FOUND");
}

#[test]
fn validation_is_deterministic() {
    let scenarios: ScenarioDoc = serde_json::from_str(
        &std::fs::read_to_string(vectors_dir().join("validation-v1.scenarios.json")).unwrap(),
    )
    .unwrap();
    for scenario in scenarios
        .scenarios
        .iter()
        .filter(|s| s.kind == "validation")
    {
        let input: ValidationInput = serde_json::from_value(scenario.input.clone()).unwrap();
        assert_eq!(validate(&input), validate(&input), "{}", scenario.id);
    }
}
